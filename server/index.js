const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, '../public')));

const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const ADMIN_SECRET = "admin12345";

let pollMaster = {
  title: "Live Poll",
  status: "voting",
  resultsRevealed: false,
  winnerText: null,
  candidates: [],
  totalVotes: 0,
  participantCount: 0
};

let votedSockets = new Set();
let adminSocketId = null;

function calculateWinnerText(candidates, totalVotes) {
  if (candidates.length === 0) return "No candidates available";
  
  const sorted = [...candidates].sort((a, b) => b.votes - a.votes);
  const highestVotes = sorted[0].votes;
  const winners = sorted.filter(c => c.votes === highestVotes);
  
  if (winners.length === 1) {
    return `${winners[0].name} won with ${highestVotes} votes`;
  } else if (winners.length === 2) {
    return `Tie: ${winners[0].name} and ${winners[1].name} with ${highestVotes} votes each`;
  } else {
    const names = winners.map(w => w.name).join(", ");
    const lastComma = names.lastIndexOf(",");
    const formattedNames = names.substring(0, lastComma) + " and" + names.substring(lastComma + 1);
    return `Tie: ${formattedNames} with ${highestVotes} votes each`;
  }
}

function addPercentages(candidates, totalVotes) {
  return candidates.map(c => ({
    ...c,
    percentage: totalVotes > 0 ? (c.votes / totalVotes * 100).toFixed(1) : 0
  }));
}

io.on('connection', (socket) => {
  console.log(`[INFO] User connected: ${socket.id}`);
  
  const dataToSend = {
    title: pollMaster.title,
    status: pollMaster.status,
    resultsRevealed: pollMaster.resultsRevealed,
    winnerText: pollMaster.winnerText,
    candidates: pollMaster.resultsRevealed ? addPercentages(pollMaster.candidates, pollMaster.totalVotes) : pollMaster.candidates,
    totalVotes: pollMaster.totalVotes,
    participantCount: pollMaster.participantCount,
    hasVoted: votedSockets.has(socket.id)
  };
  socket.emit('poll:init', dataToSend);
  
  io.emit('poll:participants', pollMaster.participantCount);
  
  socket.on('admin:unlock', ({ secret }) => {
    if (secret === ADMIN_SECRET) {
      adminSocketId = socket.id;
      socket.emit('admin:unlocked', { success: true });
      
      const adminData = {
        title: pollMaster.title,
        candidates: pollMaster.candidates,
        totalVotes: pollMaster.totalVotes,
        participantCount: pollMaster.participantCount,
        status: pollMaster.status
      };
      socket.emit('admin:full-data', adminData);
    } else {
      socket.emit('admin:unlocked', { success: false, error: "Invalid credentials" });
    }
  });
  
  socket.on('candidate:add', (data, callback) => {
    if (socket.id !== adminSocketId) {
      if (callback) callback({ success: false, error: "Unauthorized" });
      return;
    }
    
    const newCandidate = {
      id: Date.now().toString() + Math.random().toString(36).substr(2, 4),
      name: data.name,
      imageUrl: data.imageUrl || "https://via.placeholder.com/300x200?text=No+Image",
      votes: 0
    };
    
    pollMaster.candidates.push(newCandidate);
    
    io.emit('candidate:added', {
      id: newCandidate.id,
      name: newCandidate.name,
      imageUrl: newCandidate.imageUrl
    });
    
    if (adminSocketId) {
      io.to(adminSocketId).emit('admin:full-data', {
        title: pollMaster.title,
        candidates: pollMaster.candidates,
        totalVotes: pollMaster.totalVotes,
        participantCount: pollMaster.participantCount,
        status: pollMaster.status
      });
    }
    
    if (callback) callback({ success: true, candidate: newCandidate });
  });
  
  socket.on('candidate:delete', ({ candidateId }, callback) => {
    if (socket.id !== adminSocketId) {
      if (callback) callback({ success: false, error: "Unauthorized" });
      return;
    }
    
    const candidateIndex = pollMaster.candidates.findIndex(c => c.id === candidateId);
    if (candidateIndex !== -1) {
      const deletedVotes = pollMaster.candidates[candidateIndex].votes;
      pollMaster.candidates.splice(candidateIndex, 1);
      pollMaster.totalVotes -= deletedVotes;
      
      io.emit('candidate:deleted', { candidateId });
      
      if (adminSocketId) {
        io.to(adminSocketId).emit('admin:full-data', {
          title: pollMaster.title,
          candidates: pollMaster.candidates,
          totalVotes: pollMaster.totalVotes,
          participantCount: pollMaster.participantCount,
          status: pollMaster.status
        });
      }
      
      if (callback) callback({ success: true });
    } else {
      if (callback) callback({ success: false, error: "Candidate not found" });
    }
  });
  
  socket.on('poll:update-title', ({ title }, callback) => {
    if (socket.id !== adminSocketId) {
      if (callback) callback({ success: false });
      return;
    }
    
    pollMaster.title = title;
    io.emit('poll:title-updated', { title });
    if (callback) callback({ success: true });
  });
  
  socket.on('vote:cast', ({ candidateId }, callback) => {
    if (pollMaster.status === "ended") {
      if (callback) callback({ success: false, error: "Poll has concluded" });
      return;
    }
    
    if (votedSockets.has(socket.id)) {
      if (callback) callback({ success: false, error: "Vote already recorded" });
      return;
    }
    
    const candidate = pollMaster.candidates.find(c => c.id === candidateId);
    if (!candidate) {
      if (callback) callback({ success: false, error: "Candidate not found" });
      return;
    }
    
    candidate.votes++;
    pollMaster.totalVotes++;
    votedSockets.add(socket.id);
    pollMaster.participantCount = votedSockets.size;
    
    socket.emit('vote:confirmed', { 
      candidateName: candidate.name,
      totalVotes: pollMaster.totalVotes
    });
    
    if (adminSocketId) {
      io.to(adminSocketId).emit('admin:full-data', {
        title: pollMaster.title,
        candidates: pollMaster.candidates,
        totalVotes: pollMaster.totalVotes,
        participantCount: pollMaster.participantCount,
        status: pollMaster.status
      });
    }
    
    io.emit('poll:participants', pollMaster.participantCount);
    
    if (callback) callback({ success: true });
  });
  
  socket.on('admin:reveal-results', (_, callback) => {
    if (socket.id !== adminSocketId) {
      if (callback) callback({ success: false });
      return;
    }
    
    pollMaster.status = "ended";
    pollMaster.resultsRevealed = true;
    pollMaster.winnerText = calculateWinnerText(pollMaster.candidates, pollMaster.totalVotes);
    
    const candidatesWithPercentages = addPercentages(pollMaster.candidates, pollMaster.totalVotes);
    
    io.emit('results:revealed', {
      winnerText: pollMaster.winnerText,
      candidates: candidatesWithPercentages,
      totalVotes: pollMaster.totalVotes,
      participantCount: pollMaster.participantCount
    });
    
    if (callback) callback({ success: true });
  });
  
  socket.on('admin:reset-poll', (_, callback) => {
    if (socket.id !== adminSocketId) {
      if (callback) callback({ success: false });
      return;
    }
    
    pollMaster.candidates.forEach(c => c.votes = 0);
    pollMaster.totalVotes = 0;
    pollMaster.status = "voting";
    pollMaster.resultsRevealed = false;
    pollMaster.winnerText = null;
    votedSockets.clear();
    pollMaster.participantCount = 0;
    
    const sockets = io.sockets.sockets;
    for (let [id, sock] of sockets) {
      votedSockets.delete(id);
    }
    
    io.emit('poll:reset', {
      candidates: pollMaster.candidates,
      title: pollMaster.title
    });
    
    if (adminSocketId) {
      io.to(adminSocketId).emit('admin:full-data', {
        title: pollMaster.title,
        candidates: pollMaster.candidates,
        totalVotes: pollMaster.totalVotes,
        participantCount: pollMaster.participantCount,
        status: pollMaster.status
      });
    }
    
    if (callback) callback({ success: true });
  });
  
  socket.on('disconnect', () => {
    console.log(`[INFO] User disconnected: ${socket.id}`);
    votedSockets.delete(socket.id);
    pollMaster.participantCount = votedSockets.size;
    io.emit('poll:participants', pollMaster.participantCount);
    
    if (socket.id === adminSocketId) {
      adminSocketId = null;
    }
  });
});

const PORT = 3000;
server.listen(PORT, () => {
  console.log(`[INFO] Poll Master server running on http://localhost:${PORT}`);
  console.log(`[INFO] Admin authentication required`);
});