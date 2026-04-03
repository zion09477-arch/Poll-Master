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
  cors: { origin: "*", methods: ["GET", "POST"] }
});

const ADMIN_SECRET = "admin12345";

// Store polls with unique IDs
let polls = {};
let adminSocketId = null;
let votedSockets = new Map(); // socketId -> pollId

function generatePollId() {
  return Math.random().toString(36).substring(2, 8) + Date.now().toString(36);
}

function calculateWinnerText(candidates, totalVotes) {
  if (candidates.length === 0) return "No candidates";
  const sorted = [...candidates].sort((a, b) => b.votes - a.votes);
  const highest = sorted[0].votes;
  const winners = sorted.filter(c => c.votes === highest);
  if (winners.length === 1) return `${winners[0].name} won with ${highest} votes`;
  if (winners.length === 2) return `Tie: ${winners[0].name} and ${winners[1].name} with ${highest} votes each`;
  return `Tie: ${winners.map(w => w.name).join(", ")} with ${highest} votes each`;
}

function addPercentages(candidates, total) {
  return candidates.map(c => ({ ...c, percentage: total > 0 ? (c.votes / total * 100).toFixed(1) : 0 }));
}

// Serve poll page with specific poll ID
app.get('/poll/:pollId', (req, res) => {
  const { pollId } = req.params;
  if (!polls[pollId]) {
    return res.status(404).send(`
      <!DOCTYPE html>
      <html>
      <head><title>Poll Not Found</title><script src="https://cdn.tailwindcss.com"></script></head>
      <body class="bg-gradient-to-br from-slate-900 to-slate-800 min-h-screen flex items-center justify-center">
        <div class="text-center p-8 bg-white/5 rounded-2xl backdrop-blur">
          <i class="fas fa-exclamation-triangle text-5xl text-amber-500 mb-4"></i>
          <h1 class="text-2xl font-bold text-white mb-2">Poll Not Found</h1>
          <p class="text-slate-400">This poll doesn't exist or has been deleted.</p>
        </div>
      </body>
      </html>
    `);
  }
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// API endpoint for admin to get poll link
app.get('/api/poll/:pollId', (req, res) => {
  const { pollId } = req.params;
  if (!polls[pollId]) return res.status(404).json({ error: 'Not found' });
  res.json({ pollId, title: polls[pollId].title });
});

io.on('connection', (socket) => {
  console.log(`[INFO] User connected: ${socket.id}`);

  // Join a specific poll room
  socket.on('join:poll', ({ pollId }, callback) => {
    if (!polls[pollId]) {
      if (callback) callback({ success: false, error: 'Poll not found' });
      return;
    }
    
    socket.join(`poll:${pollId}`);
    socket.currentPollId = pollId;
    
    const poll = polls[pollId];
    const hasVoted = votedSockets.get(socket.id) === pollId;
    
    socket.emit('poll:init', {
      pollId: pollId,
      title: poll.title,
      status: poll.status,
      resultsRevealed: poll.resultsRevealed,
      winnerText: poll.winnerText,
      totalVotes: poll.totalVotes,
      participantCount: poll.participantCount,
      candidates: poll.resultsRevealed ? addPercentages(poll.candidates, poll.totalVotes) : poll.candidates,
      hasVoted: hasVoted,
      shareableLink: `${getBaseUrl()}/poll/${pollId}`
    });
    
    socket.emit('poll:participants', poll.participantCount);
    
    if (callback) callback({ success: true });
  });

  // Admin: get all polls
  socket.on('admin:get-polls', (_, callback) => {
    if (socket.id !== adminSocketId) return;
    const pollList = Object.entries(polls).map(([id, p]) => ({
      id, title: p.title, candidateCount: p.candidates.length, totalVotes: p.totalVotes, status: p.status
    }));
    callback({ polls: pollList });
  });

  // Admin: create new poll
  socket.on('poll:create', ({ title }, callback) => {
    if (socket.id !== adminSocketId) return callback?.({ success: false });
    const pollId = generatePollId();
    polls[pollId] = {
      id: pollId,
      title: title || `Poll ${Object.keys(polls).length + 1}`,
      status: "voting",
      resultsRevealed: false,
      winnerText: null,
      candidates: [],
      totalVotes: 0,
      participantCount: 0
    };
    const shareableLink = `${getBaseUrl()}/poll/${pollId}`;
    callback?.({ success: true, pollId, shareableLink });
    // Notify admin of updated poll list
    const pollList = Object.entries(polls).map(([id, p]) => ({
      id, title: p.title, candidateCount: p.candidates.length, totalVotes: p.totalVotes, status: p.status
    }));
    io.to(adminSocketId).emit('admin:polls-list', { polls: pollList });
  });

  // Admin: delete poll
  socket.on('poll:delete', ({ pollId }, callback) => {
    if (socket.id !== adminSocketId) return callback?.({ success: false });
    if (!polls[pollId]) return callback?.({ success: false, error: 'Poll not found' });
    
    // Notify all users in that poll room to redirect
    io.to(`poll:${pollId}`).emit('poll:deleted', { message: 'This poll has been deleted by the administrator' });
    
    // Remove the poll
    delete polls[pollId];
    
    // Clean up voted sockets for this poll
    for (let [sockId, pollIdVoted] of votedSockets.entries()) {
      if (pollIdVoted === pollId) votedSockets.delete(sockId);
    }
    
    // Update admin's poll list
    const pollList = Object.entries(polls).map(([id, p]) => ({
      id, title: p.title, candidateCount: p.candidates.length, totalVotes: p.totalVotes, status: p.status
    }));
    io.to(adminSocketId).emit('admin:polls-list', { polls: pollList });
    
    callback?.({ success: true });
  });

  // Admin: switch to edit a poll
  socket.on('admin:edit-poll', ({ pollId }, callback) => {
    if (socket.id !== adminSocketId) return callback?.({ success: false });
    if (!polls[pollId]) return callback?.({ success: false });
    socket.currentEditPollId = pollId;
    const poll = polls[pollId];
    callback({
      success: true,
      poll: {
        id: poll.id,
        title: poll.title,
        candidates: poll.candidates,
        totalVotes: poll.totalVotes,
        participantCount: poll.participantCount,
        status: poll.status
      }
    });
  });

  // Admin: update poll title
  socket.on('poll:update-title', ({ title }, callback) => {
    if (socket.id !== adminSocketId) return callback?.({ success: false });
    const pollId = socket.currentEditPollId;
    if (!pollId || !polls[pollId]) return callback?.({ success: false });
    polls[pollId].title = title;
    io.to(`poll:${pollId}`).emit('poll:title-updated', { title });
    callback?.({ success: true });
  });

  // Admin: add candidate
  socket.on('candidate:add', (data, callback) => {
    if (socket.id !== adminSocketId) return callback?.({ success: false });
    const pollId = socket.currentEditPollId;
    if (!pollId || !polls[pollId]) return callback?.({ success: false });
    
    const newCandidate = {
      id: Date.now() + Math.random().toString(36).substr(2, 4),
      name: data.name,
      imageUrl: data.imageUrl || "https://via.placeholder.com/300x200?text=No+Image",
      votes: 0
    };
    polls[pollId].candidates.push(newCandidate);
    
    io.to(`poll:${pollId}`).emit('candidate:added', {
      id: newCandidate.id, name: newCandidate.name, imageUrl: newCandidate.imageUrl
    });
    
    callback?.({ success: true, candidate: newCandidate });
  });

  // Admin: delete candidate
  socket.on('candidate:delete', ({ candidateId }, callback) => {
    if (socket.id !== adminSocketId) return callback?.({ success: false });
    const pollId = socket.currentEditPollId;
    if (!pollId || !polls[pollId]) return callback?.({ success: false });
    
    const idx = polls[pollId].candidates.findIndex(c => c.id === candidateId);
    if (idx !== -1) {
      polls[pollId].totalVotes -= polls[pollId].candidates[idx].votes;
      polls[pollId].candidates.splice(idx, 1);
      io.to(`poll:${pollId}`).emit('candidate:deleted', { candidateId });
      callback?.({ success: true });
    } else {
      callback?.({ success: false });
    }
  });

  // Voter: cast vote
  socket.on('vote:cast', ({ candidateId }, callback) => {
    const pollId = socket.currentPollId;
    if (!pollId || !polls[pollId]) return callback?.({ success: false, error: 'Poll not found' });
    
    const poll = polls[pollId];
    if (poll.status === "ended") return callback?.({ success: false, error: "Poll ended" });
    if (votedSockets.get(socket.id) === pollId) return callback?.({ success: false, error: "Already voted" });
    
    const candidate = poll.candidates.find(c => c.id === candidateId);
    if (!candidate) return callback?.({ success: false, error: "Candidate not found" });
    
    candidate.votes++;
    poll.totalVotes++;
    votedSockets.set(socket.id, pollId);
    poll.participantCount = votedSockets.size;
    
    socket.emit('vote:confirmed', { candidateName: candidate.name });
    io.to(`poll:${pollId}`).emit('poll:stats-update', {
      totalVotes: poll.totalVotes,
      participantCount: poll.participantCount
    });
    
    callback?.({ success: true });
  });

  // Admin: reveal results
  socket.on('admin:reveal-results', (_, callback) => {
    if (socket.id !== adminSocketId) return callback?.({ success: false });
    const pollId = socket.currentEditPollId;
    if (!pollId || !polls[pollId]) return callback?.({ success: false });
    
    const poll = polls[pollId];
    poll.status = "ended";
    poll.resultsRevealed = true;
    poll.winnerText = calculateWinnerText(poll.candidates, poll.totalVotes);
    
    io.to(`poll:${pollId}`).emit('results:revealed', {
      winnerText: poll.winnerText,
      candidates: addPercentages(poll.candidates, poll.totalVotes),
      totalVotes: poll.totalVotes,
      participantCount: poll.participantCount
    });
    
    callback?.({ success: true });
  });

  // Admin: reset poll votes (not delete)
  socket.on('admin:reset-poll', (_, callback) => {
    if (socket.id !== adminSocketId) return callback?.({ success: false });
    const pollId = socket.currentEditPollId;
    if (!pollId || !polls[pollId]) return callback?.({ success: false });
    
    const poll = polls[pollId];
    poll.candidates.forEach(c => c.votes = 0);
    poll.totalVotes = 0;
    poll.status = "voting";
    poll.resultsRevealed = false;
    poll.winnerText = null;
    
    // Clear votes for this poll
    for (let [sId, pId] of votedSockets.entries()) {
      if (pId === pollId) votedSockets.delete(sId);
    }
    poll.participantCount = 0;
    
    io.to(`poll:${pollId}`).emit('poll:reset', {
      candidates: poll.candidates,
      title: poll.title
    });
    
    callback?.({ success: true });
  });

  // Admin unlock
  socket.on('admin:unlock', ({ secret }, callback) => {
    if (secret === ADMIN_SECRET) {
      adminSocketId = socket.id;
      socket.emit('admin:unlocked', { success: true });
      const pollList = Object.entries(polls).map(([id, p]) => ({
        id, title: p.title, candidateCount: p.candidates.length, totalVotes: p.totalVotes, status: p.status
      }));
      socket.emit('admin:polls-list', { polls: pollList });
      callback?.({ success: true });
    } else {
      callback?.({ success: false, error: "Invalid credentials" });
    }
  });

  socket.on('disconnect', () => {
    votedSockets.delete(socket.id);
    if (socket.currentPollId && polls[socket.currentPollId]) {
      polls[socket.currentPollId].participantCount = votedSockets.size;
      io.to(`poll:${socket.currentPollId}`).emit('poll:participants', polls[socket.currentPollId].participantCount);
    }
    if (socket.id === adminSocketId) adminSocketId = null;
  });
});

function getBaseUrl() {
  return `http://localhost:3000`;
}

const PORT = 3000;
server.listen(PORT, () => {
  console.log(`[INFO] Poll Master running on http://localhost:${PORT}`);
  console.log(`[INFO] Admin secret: ${ADMIN_SECRET}`);
});