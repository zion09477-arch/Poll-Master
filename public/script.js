/**
 * Poll Master - Frontend Application
 * Premium Realtime Polling System
 */

const socket = io();

let currentUserHasVoted = false;
let isAdmin = false;
let resultsChart = null;

document.addEventListener('DOMContentLoaded', () => {
  initializeEventListeners();
});

/* Socket Event Handlers */
socket.on('poll:init', (data) => {
  currentUserHasVoted = data.hasVoted;
  
  // Update title display
  if (data.title && data.title !== 'Live Poll') {
    document.getElementById('pollTitle').textContent = data.title;
    const badge = document.getElementById('pollTitleBadge');
    badge.classList.remove('border-white/10');
    badge.classList.add('border-indigo-400/50', 'bg-indigo-500/10');
  }
  
  if (!data.resultsRevealed && data.status !== 'ended') {
    document.getElementById('resultsArea').classList.add('hidden');
    document.getElementById('voterArea').classList.remove('hidden');
    
    if (data.candidates && data.candidates.length > 0) {
      hasCandidates = true;
      document.getElementById('emptyState').classList.add('hidden');
      document.getElementById('candidatesGrid').classList.remove('hidden');
      document.getElementById('voterStats').classList.remove('hidden');
      renderCandidates(data.candidates, false, data.hasVoted);
    } else {
      document.getElementById('emptyState').classList.remove('hidden');
      document.getElementById('candidatesGrid').classList.add('hidden');
      document.getElementById('voterStats').classList.add('hidden');
    }
  } else if (data.resultsRevealed) {
    displayResults(data);
  }
  
  document.getElementById('participantCount').textContent = data.participantCount;
});

socket.on('poll:participants', (count) => {
  document.getElementById('participantCount').textContent = count;
  const adminParticipants = document.getElementById('adminParticipants');
  if (adminParticipants) adminParticipants.textContent = count;
});

socket.on('poll:title-updated', ({ title }) => {
  document.getElementById('pollTitle').textContent = title;
  const badge = document.getElementById('pollTitleBadge');
  badge.classList.remove('border-white/10');
  badge.classList.add('border-indigo-400/50', 'bg-indigo-500/10');
  displayNotification(`Poll title updated to "${title}"`, 'success');
});

socket.on('candidate:added', (candidate) => {
  if (document.getElementById('resultsArea').classList.contains('hidden')) {
    document.getElementById('emptyState').classList.add('hidden');
    document.getElementById('candidatesGrid').classList.remove('hidden');
    document.getElementById('voterStats').classList.remove('hidden');
    appendCandidateToGrid(candidate);
  }
});

socket.on('candidate:deleted', ({ candidateId }) => {
  const card = document.querySelector(`.candidate-card[data-id="${candidateId}"]`);
  if (card) {
    card.remove();
    displayNotification('Candidate removed', 'info');
  }
  
  if (isAdmin) {
    const adminRow = document.querySelector(`.admin-candidate-row[data-id="${candidateId}"]`);
    if (adminRow) adminRow.remove();
  }
  
  // Check if no candidates left
  const remainingCards = document.querySelectorAll('.candidate-card');
  if (remainingCards.length === 0 && !document.getElementById('resultsArea').classList.contains('hidden')) {
    document.getElementById('emptyState').classList.remove('hidden');
    document.getElementById('candidatesGrid').classList.add('hidden');
    document.getElementById('voterStats').classList.add('hidden');
  }
});

socket.on('vote:confirmed', ({ candidateName, totalVotes }) => {
  currentUserHasVoted = true;
  displayNotification(`✓ Vote recorded for ${candidateName}`, 'success');
  
  document.querySelectorAll('.vote-btn').forEach(btn => {
    btn.disabled = true;
    btn.textContent = 'VOTED';
    btn.style.background = '#475569';
  });
});

socket.on('results:revealed', (data) => {
  displayResults(data);
  triggerConfetti();
});

socket.on('poll:reset', (data) => {
  currentUserHasVoted = false;
  document.getElementById('resultsArea').classList.add('hidden');
  document.getElementById('voterArea').classList.remove('hidden');
  
  if (data.candidates && data.candidates.length > 0) {
    document.getElementById('emptyState').classList.add('hidden');
    document.getElementById('candidatesGrid').classList.remove('hidden');
    document.getElementById('voterStats').classList.remove('hidden');
    renderCandidates(data.candidates, false, false);
  } else {
    document.getElementById('emptyState').classList.remove('hidden');
    document.getElementById('candidatesGrid').classList.add('hidden');
    document.getElementById('voterStats').classList.add('hidden');
  }
  
  const toast = document.getElementById('confirmationMessage');
  toast.classList.add('hidden');
  displayNotification('Poll has been reset by administrator', 'info');
});

/* Admin Events */
socket.on('admin:unlocked', ({ success, error }) => {
  if (success) {
    isAdmin = true;
    document.getElementById('adminUnlockPanel').classList.add('hidden');
    document.getElementById('adminPanel').classList.remove('hidden');
    displayNotification('Administrator access granted', 'success');
  } else {
    const errorEl = document.getElementById('adminError');
    errorEl.textContent = error || 'Authentication failed';
    errorEl.classList.remove('hidden');
    setTimeout(() => errorEl.classList.add('hidden'), 3000);
    displayNotification('Authentication failed', 'error');
  }
});

socket.on('admin:full-data', (data) => {
  if (!isAdmin) return;
  
  document.getElementById('adminTotalVotes').textContent = data.totalVotes;
  document.getElementById('adminParticipants').textContent = data.participantCount;
  
  renderAdminCandidateList(data.candidates);
});

/* UI Rendering Functions */
function renderCandidates(candidates, showPercentages = false, hasVoted = false) {
  const grid = document.getElementById('candidatesGrid');
  if (!grid) return;
  
  grid.innerHTML = candidates.map(candidate => `
    <div class="candidate-card group" data-id="${candidate.id}">
      <div class="relative overflow-hidden">
        <img src="${candidate.imageUrl}" alt="${escapeHtml(candidate.name)}" 
             class="candidate-image w-full transition-transform duration-500 group-hover:scale-105"
             onerror="this.src='https://via.placeholder.com/300x200?text=No+Image'">
        <div class="absolute inset-0 bg-gradient-to-t from-slate-900 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
      </div>
      <div class="p-5 text-center">
        <h3 class="text-xl font-bold text-white mb-3">${escapeHtml(candidate.name)}</h3>
        ${showPercentages ? `
          <div class="mb-4">
            <div class="bg-slate-700 rounded-full h-2 overflow-hidden">
              <div class="bg-gradient-to-r from-indigo-500 to-purple-500 h-full transition-all duration-700" style="width: ${candidate.percentage}%"></div>
            </div>
            <p class="text-indigo-300 mt-2 text-sm font-medium">${candidate.percentage}% (${candidate.votes} votes)</p>
          </div>
        ` : ''}
        <button class="vote-btn ${hasVoted ? 'opacity-60 cursor-not-allowed' : ''} text-white font-semibold py-2.5 px-6 rounded-xl transition-all duration-300 w-full shadow-lg"
                data-id="${candidate.id}"
                data-name="${escapeHtml(candidate.name)}"
                ${hasVoted ? 'disabled' : ''}>
          ${hasVoted ? '<i class="fas fa-check mr-2"></i>VOTED' : '<i class="fas fa-vote-yea mr-2"></i>CAST VOTE'}
        </button>
      </div>
    </div>
  `).join('');
  
  if (!hasVoted && !showPercentages) {
    document.querySelectorAll('.vote-btn:not(:disabled)').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const candidateId = btn.getAttribute('data-id');
        const candidateName = btn.getAttribute('data-name');
        submitVote(candidateId, candidateName);
      });
    });
  }
}

function appendCandidateToGrid(candidate) {
  const grid = document.getElementById('candidatesGrid');
  const card = document.createElement('div');
  card.className = 'candidate-card group';
  card.setAttribute('data-id', candidate.id);
  card.innerHTML = `
    <div class="relative overflow-hidden">
      <img src="${candidate.imageUrl}" alt="${escapeHtml(candidate.name)}" 
           class="candidate-image w-full transition-transform duration-500 group-hover:scale-105"
           onerror="this.src='https://via.placeholder.com/300x200?text=No+Image'">
      <div class="absolute inset-0 bg-gradient-to-t from-slate-900 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
    </div>
    <div class="p-5 text-center">
      <h3 class="text-xl font-bold text-white mb-3">${escapeHtml(candidate.name)}</h3>
      <button class="vote-btn ${currentUserHasVoted ? 'opacity-60 cursor-not-allowed' : ''} text-white font-semibold py-2.5 px-6 rounded-xl transition-all duration-300 w-full shadow-lg"
              data-id="${candidate.id}"
              data-name="${escapeHtml(candidate.name)}"
              ${currentUserHasVoted ? 'disabled' : ''}>
        ${currentUserHasVoted ? '<i class="fas fa-check mr-2"></i>VOTED' : '<i class="fas fa-vote-yea mr-2"></i>CAST VOTE'}
      </button>
    </div>
  `;
  
  if (!currentUserHasVoted) {
    const btn = card.querySelector('.vote-btn');
    btn.addEventListener('click', () => {
      submitVote(candidate.id, candidate.name);
    });
  }
  
  grid.appendChild(card);
}

function renderAdminCandidateList(candidates) {
  const container = document.getElementById('adminCandidatesList');
  if (!container) return;
  
  if (!candidates || candidates.length === 0) {
    container.innerHTML = `
      <div class="text-center py-8">
        <i class="fas fa-database text-3xl text-slate-600 mb-2"></i>
        <p class="text-slate-500">No candidates in registry</p>
      </div>
    `;
    return;
  }
  
  container.innerHTML = candidates.map(candidate => `
    <div class="admin-candidate-row flex justify-between items-center p-3" data-id="${candidate.id}">
      <div class="flex-1">
        <p class="font-semibold text-white">${escapeHtml(candidate.name)}</p>
        <p class="text-sm text-indigo-300"><i class="fas fa-vote-yea mr-1"></i>${candidate.votes} ballots</p>
      </div>
      <button class="delete-candidate bg-rose-600/80 hover:bg-rose-600 text-white px-3 py-1.5 rounded-lg text-sm transition-all duration-300 flex items-center gap-2" data-id="${candidate.id}">
        <i class="fas fa-trash-alt"></i> Remove
      </button>
    </div>
  `).join('');
  
  document.querySelectorAll('.delete-candidate').forEach(btn => {
    btn.addEventListener('click', () => {
      const candidateId = btn.getAttribute('data-id');
      socket.emit('candidate:delete', { candidateId }, (response) => {
        if (response && response.success) {
          displayNotification('Candidate removed', 'info');
        }
      });
    });
  });
}

function submitVote(candidateId, candidateName) {
  if (currentUserHasVoted) {
    displayNotification('Your ballot has already been recorded', 'error');
    return;
  }
  
  socket.emit('vote:cast', { candidateId }, (response) => {
    if (response && response.error) {
      displayNotification(response.error, 'error');
    }
  });
}

function displayResults(data) {
  document.getElementById('voterArea').classList.add('hidden');
  document.getElementById('resultsArea').classList.remove('hidden');
  document.getElementById('winnerText').innerHTML = `<i class="fas fa-trophy mr-3"></i>${escapeHtml(data.winnerText)}`;
  document.getElementById('finalTotalVotes').textContent = data.totalVotes;
  document.getElementById('finalParticipants').textContent = data.participantCount;
  
  const ctx = document.getElementById('resultsChart').getContext('2d');
  if (resultsChart) resultsChart.destroy();
  
  resultsChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: data.candidates.map(c => c.name),
      datasets: [{
        label: 'Percentage of Votes',
        data: data.candidates.map(c => c.percentage),
        backgroundColor: 'rgba(99, 102, 241, 0.7)',
        borderColor: 'rgba(99, 102, 241, 1)',
        borderWidth: 2,
        borderRadius: 8,
        barPercentage: 0.65,
        categoryPercentage: 0.8
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: {
          labels: { color: '#cbd5e1', font: { size: 12, weight: '500' } }
        },
        tooltip: {
          callbacks: {
            label: (context) => `${context.raw}% of total votes`
          }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          max: 100,
          grid: { color: 'rgba(255,255,255,0.08)' },
          ticks: { color: '#cbd5e1', callback: (val) => `${val}%` }
        },
        x: {
          ticks: { color: '#cbd5e1', font: { size: 12, weight: '500' } },
          grid: { display: false }
        }
      }
    }
  });
}

function displayNotification(message, type = 'success') {
  const toast = document.getElementById('confirmationMessage');
  const textSpan = document.getElementById('confirmText');
  const iconSpan = toast.querySelector('i');
  
  textSpan.textContent = message;
  toast.classList.remove('hidden', 'toast-fade-out');
  
  const bgDiv = toast.querySelector('div');
  if (type === 'error') {
    bgDiv.className = 'bg-gradient-to-r from-rose-600 to-pink-600 text-white px-6 py-3 rounded-xl shadow-2xl flex items-center gap-3 backdrop-blur';
    iconSpan.className = 'fas fa-exclamation-circle';
  } else if (type === 'info') {
    bgDiv.className = 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white px-6 py-3 rounded-xl shadow-2xl flex items-center gap-3 backdrop-blur';
    iconSpan.className = 'fas fa-info-circle';
  } else {
    bgDiv.className = 'bg-gradient-to-r from-emerald-600 to-teal-600 text-white px-6 py-3 rounded-xl shadow-2xl flex items-center gap-3 backdrop-blur';
    iconSpan.className = 'fas fa-check-circle';
  }
  
  setTimeout(() => {
    toast.classList.add('toast-fade-out');
    setTimeout(() => {
      toast.classList.add('hidden');
      toast.classList.remove('toast-fade-out');
    }, 3000);
  }, 2800);
}

function triggerConfetti() {
  canvasConfetti({
    particleCount: 150,
    spread: 80,
    origin: { y: 0.6 },
    colors: ['#4f46e5', '#7c3aed', '#a78bfa', '#c4b5fd']
  });
  
  setTimeout(() => {
    canvasConfetti({
      particleCount: 100,
      spread: 100,
      origin: { y: 0.7, x: 0.2 },
      colors: ['#4f46e5', '#7c3aed']
    });
  }, 200);
  
  setTimeout(() => {
    canvasConfetti({
      particleCount: 100,
      spread: 100,
      origin: { y: 0.7, x: 0.8 },
      colors: ['#4f46e5', '#7c3aed']
    });
  }, 400);
}

function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function initializeEventListeners() {
  // Double-click header for admin access
  const header = document.querySelector('h1');
  if (header && header.parentElement && header.parentElement.parentElement) {
    header.parentElement.parentElement.addEventListener('dblclick', () => {
      document.getElementById('adminUnlockPanel').classList.toggle('hidden');
    });
  }
  
  // Unlock admin
  const unlockBtn = document.getElementById('unlockAdminBtn');
  if (unlockBtn) {
    unlockBtn.addEventListener('click', () => {
      const secret = document.getElementById('adminSecret').value;
      if (secret.trim()) {
        socket.emit('admin:unlock', { secret });
      } else {
        displayNotification('Enter security credentials', 'error');
      }
    });
  }
  
  // Set poll title
  const setTitleBtn = document.getElementById('setPollTitleBtn');
  if (setTitleBtn) {
    setTitleBtn.addEventListener('click', () => {
      const title = document.getElementById('pollTitleInput').value.trim();
      if (title) {
        socket.emit('poll:update-title', { title });
        document.getElementById('pollTitleInput').value = '';
      } else {
        displayNotification('Please enter a poll title', 'error');
      }
    });
  }
  
  // Add candidate
  const addBtn = document.getElementById('addCandidateBtn');
  if (addBtn) {
    addBtn.addEventListener('click', () => {
      const name = document.getElementById('candidateName').value.trim();
      const imageUrl = document.getElementById('candidateImage').value.trim();
      
      if (!name) {
        displayNotification('Candidate name is required', 'error');
        return;
      }
      
      socket.emit('candidate:add', { name, imageUrl }, (response) => {
        if (response && response.success) {
          displayNotification(`Candidate "${name}" added`, 'success');
          document.getElementById('candidateName').value = '';
          document.getElementById('candidateImage').value = '';
        } else if (response && response.error) {
          displayNotification(response.error, 'error');
        }
      });
    });
  }
  
  // Reset poll
  const resetBtn = document.getElementById('resetPollBtn');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      if (confirm('Reset all votes? This action cannot be undone.')) {
        socket.emit('admin:reset-poll');
      }
    });
  }
  
  // Reveal results
  const revealBtn = document.getElementById('revealResultsBtn');
  if (revealBtn) {
    revealBtn.addEventListener('click', () => {
      if (confirm('Reveal results to all participants? Voting will close.')) {
        socket.emit('admin:reveal-results');
      }
    });
  }
  
  // Enter key for admin secret
  document.getElementById('adminSecret')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') unlockBtn?.click();
  });
  
  // Enter key for poll title
  document.getElementById('pollTitleInput')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') setTitleBtn?.click();
  });
}