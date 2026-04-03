const socket = io();
let currentUserHasVoted = false, isAdmin = false, resultsChart = null;
let currentPollId = null;
let currentEditPollId = null;

// Get poll ID from URL path
const pathParts = window.location.pathname.split('/');
if (pathParts[1] === 'poll' && pathParts[2]) {
  currentPollId = pathParts[2];
}

document.addEventListener('DOMContentLoaded', () => {
  initializeEventListeners();
  
  document.querySelector('h1')?.parentElement?.parentElement?.addEventListener('dblclick', () => {
    document.getElementById('adminUnlockPanel').classList.toggle('hidden');
  });
  
  if (currentPollId) {
    socket.emit('join:poll', { pollId: currentPollId }, (response) => {
      if (!response?.success) {
        document.body.innerHTML = `<div class="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 to-slate-800"><div class="text-center p-8 bg-white/5 rounded-2xl"><i class="fas fa-exclamation-triangle text-5xl text-amber-500 mb-4"></i><h1 class="text-2xl font-bold text-white">Poll Not Found</h1><p class="text-slate-400">${response?.error || 'This poll does not exist'}</p></div></div>`;
      }
    });
  } else {
    // No poll ID in URL - show message
    document.getElementById('voterArea').innerHTML = `<div class="text-center py-20 bg-white/5 rounded-2xl"><i class="fas fa-link text-5xl text-indigo-400 mb-4"></i><p class="text-slate-300 text-xl">No poll selected</p><p class="text-slate-500 mt-2">Use a shareable link from the administrator</p></div>`;
  }
});

socket.on('poll:init', (data) => {
  currentUserHasVoted = data.hasVoted;
  document.getElementById('pollTitle').textContent = data.title;
  
  if (!data.resultsRevealed && data.status !== 'ended') {
    document.getElementById('resultsArea').classList.add('hidden');
    document.getElementById('voterArea').classList.remove('hidden');
    if (data.candidates?.length > 0) {
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

socket.on('poll:stats-update', ({ totalVotes, participantCount }) => {
  document.getElementById('participantCount').textContent = participantCount;
  if (isAdmin) {
    document.getElementById('adminTotalVotes').textContent = totalVotes;
    document.getElementById('adminParticipants').textContent = participantCount;
  }
});

socket.on('poll:title-updated', ({ title }) => {
  document.getElementById('pollTitle').textContent = title;
  if (isAdmin && currentEditPollId) {
    document.getElementById('editingPollTitle').textContent = title;
  }
  displayNotification(`Title updated to "${title}"`, 'success');
});

socket.on('candidate:added', (candidate) => {
  if (!document.getElementById('resultsArea').classList.contains('hidden')) return;
  document.getElementById('emptyState').classList.add('hidden');
  document.getElementById('candidatesGrid').classList.remove('hidden');
  document.getElementById('voterStats').classList.remove('hidden');
  appendCandidateToGrid(candidate);
  if (isAdmin) refreshAdminData();
});

socket.on('candidate:deleted', ({ candidateId }) => {
  document.querySelector(`.candidate-card[data-id="${candidateId}"]`)?.remove();
  if (document.querySelectorAll('.candidate-card').length === 0 && !document.getElementById('resultsArea').classList.contains('hidden')) {
    document.getElementById('emptyState').classList.remove('hidden');
    document.getElementById('candidatesGrid').classList.add('hidden');
    document.getElementById('voterStats').classList.add('hidden');
  }
  if (isAdmin) refreshAdminData();
});

socket.on('vote:confirmed', ({ candidateName }) => {
  currentUserHasVoted = true;
  displayNotification(`Voted for ${candidateName}`, 'success');
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
  renderCandidates(data.candidates, false, false);
  if (isAdmin) refreshAdminData();
});

socket.on('poll:deleted', ({ message }) => {
  displayNotification(message, 'error');
  setTimeout(() => {
    window.location.href = '/';
  }, 2000);
});

// Admin events
socket.on('admin:unlocked', ({ success, error }) => {
  if (success) {
    isAdmin = true;
    document.getElementById('adminUnlockPanel').classList.add('hidden');
    document.getElementById('adminPanel').classList.remove('hidden');
    displayNotification('Admin access granted', 'success');
  } else {
    document.getElementById('adminError').textContent = error;
    document.getElementById('adminError').classList.remove('hidden');
    setTimeout(() => document.getElementById('adminError').classList.add('hidden'), 3000);
  }
});

socket.on('admin:polls-list', ({ polls }) => {
  renderPollList(polls);
});

function renderPollList(polls) {
  const container = document.getElementById('pollList');
  if (!polls.length) {
    container.innerHTML = '<p class="text-slate-500 text-center py-4">No polls yet. Create one above.</p>';
    return;
  }
  container.innerHTML = polls.map(p => `
    <div class="flex justify-between items-center p-3 bg-slate-800/50 rounded-lg">
      <div class="flex-1">
        <p class="text-white font-medium">${escapeHtml(p.title)}</p>
        <p class="text-xs text-slate-400">${p.candidateCount} candidates · ${p.totalVotes} votes</p>
      </div>
      <button class="edit-poll-btn bg-indigo-600 hover:bg-indigo-700 px-3 py-1.5 rounded-lg text-sm transition-all" data-id="${p.id}"><i class="fas fa-edit"></i> Edit</button>
    </div>
  `).join('');
  
  document.querySelectorAll('.edit-poll-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const pollId = btn.dataset.id;
      currentEditPollId = pollId;
      socket.emit('admin:edit-poll', { pollId }, (response) => {
        if (response?.success) {
          document.getElementById('editSection').classList.remove('hidden');
          document.getElementById('editingPollTitle').textContent = response.poll.title;
          document.getElementById('adminTotalVotes').textContent = response.poll.totalVotes;
          document.getElementById('adminParticipants').textContent = response.poll.participantCount;
          renderAdminCandidates(response.poll.candidates);
        }
      });
    });
  });
}

function renderAdminCandidates(candidates) {
  const container = document.getElementById('adminCandidatesList');
  if (!candidates?.length) {
    container.innerHTML = '<p class="text-slate-500 text-center py-2">No candidates</p>';
    return;
  }
  container.innerHTML = candidates.map(c => `
    <div class="flex justify-between items-center p-2 bg-slate-800/50 rounded-lg" data-id="${c.id}">
      <span class="text-white">${escapeHtml(c.name)}</span>
      <div class="flex items-center gap-3">
        <span class="text-indigo-300 text-sm">${c.votes} votes</span>
        <button class="delete-candidate-admin bg-rose-600/80 hover:bg-rose-600 px-2 py-1 rounded text-xs transition-all" data-id="${c.id}"><i class="fas fa-trash"></i></button>
      </div>
    </div>
  `).join('');
  
  document.querySelectorAll('.delete-candidate-admin').forEach(btn => {
    btn.addEventListener('click', () => {
      socket.emit('candidate:delete', { candidateId: btn.dataset.id });
    });
  });
}

function refreshAdminData() {
  if (currentEditPollId) {
    socket.emit('admin:edit-poll', { pollId: currentEditPollId }, (response) => {
      if (response?.success) {
        document.getElementById('adminTotalVotes').textContent = response.poll.totalVotes;
        document.getElementById('adminParticipants').textContent = response.poll.participantCount;
        renderAdminCandidates(response.poll.candidates);
      }
    });
  }
}

function renderCandidates(candidates, showPercentages, hasVoted) {
  const grid = document.getElementById('candidatesGrid');
  if (!candidates?.length) return;
  grid.innerHTML = candidates.map(c => `
    <div class="candidate-card group" data-id="${c.id}">
      <img src="${c.imageUrl}" class="candidate-image w-full" onerror="this.src='https://via.placeholder.com/300x200?text=No+Image'">
      <div class="p-5 text-center">
        <h3 class="text-xl font-bold text-white mb-3">${escapeHtml(c.name)}</h3>
        ${showPercentages ? `<div class="mb-4"><div class="bg-slate-700 rounded-full h-2 overflow-hidden"><div class="bg-gradient-to-r from-indigo-500 to-purple-500 h-full" style="width: ${c.percentage}%"></div></div><p class="text-indigo-300 mt-2">${c.percentage}% (${c.votes} votes)</p></div>` : ''}
        <button class="vote-btn text-white font-semibold py-2.5 px-6 rounded-xl w-full" data-id="${c.id}" data-name="${escapeHtml(c.name)}" ${hasVoted ? 'disabled' : ''}>${hasVoted ? '<i class="fas fa-check mr-2"></i>VOTED' : '<i class="fas fa-vote-yea mr-2"></i>VOTE'}</button>
      </div>
    </div>
  `).join('');
  if (!hasVoted && !showPercentages) {
    document.querySelectorAll('.vote-btn:not(:disabled)').forEach(btn => {
      btn.addEventListener('click', () => submitVote(btn.dataset.id, btn.dataset.name));
    });
  }
}

function appendCandidateToGrid(candidate) {
  const grid = document.getElementById('candidatesGrid');
  const card = document.createElement('div');
  card.className = 'candidate-card group';
  card.setAttribute('data-id', candidate.id);
  card.innerHTML = `
    <img src="${candidate.imageUrl}" class="candidate-image w-full" onerror="this.src='https://via.placeholder.com/300x200?text=No+Image'">
    <div class="p-5 text-center">
      <h3 class="text-xl font-bold text-white mb-3">${escapeHtml(candidate.name)}</h3>
      <button class="vote-btn text-white font-semibold py-2.5 px-6 rounded-xl w-full" data-id="${candidate.id}" data-name="${escapeHtml(candidate.name)}" ${currentUserHasVoted ? 'disabled' : ''}>${currentUserHasVoted ? '<i class="fas fa-check mr-2"></i>VOTED' : '<i class="fas fa-vote-yea mr-2"></i>VOTE'}</button>
    </div>
  `;
  if (!currentUserHasVoted) {
    card.querySelector('.vote-btn').addEventListener('click', () => submitVote(candidate.id, candidate.name));
  }
  grid.appendChild(card);
}

function submitVote(id, name) {
  if (currentUserHasVoted) { displayNotification('Already voted', 'error'); return; }
  socket.emit('vote:cast', { candidateId: id });
}

function displayResults(data) {
  document.getElementById('voterArea').classList.add('hidden');
  document.getElementById('resultsArea').classList.remove('hidden');
  document.getElementById('winnerText').innerHTML = `<i class="fas fa-trophy mr-3"></i>${data.winnerText || 'No winner'}`;
  document.getElementById('finalTotalVotes').textContent = data.totalVotes;
  document.getElementById('finalParticipants').textContent = data.participantCount;
  if (resultsChart) resultsChart.destroy();
  resultsChart = new Chart(document.getElementById('resultsChart'), {
    type: 'bar',
    data: { labels: data.candidates.map(c => c.name), datasets: [{ label: 'Votes (%)', data: data.candidates.map(c => c.percentage), backgroundColor: 'rgba(99,102,241,0.7)', borderRadius: 8 }] },
    options: { responsive: true, scales: { y: { beginAtZero: true, max: 100, ticks: { color: '#cbd5e1', callback: v => v + '%' } }, x: { ticks: { color: '#cbd5e1' } } }, plugins: { legend: { labels: { color: '#cbd5e1' } } } }
  });
}

function displayNotification(msg, type) {
  const toast = document.getElementById('confirmationMessage'), span = document.getElementById('confirmText'), icon = toast.querySelector('i');
  span.textContent = msg;
  toast.classList.remove('hidden', 'toast-fade-out');
  const div = toast.querySelector('div');
  if (type === 'error') { div.className = 'bg-gradient-to-r from-rose-600 to-pink-600 text-white px-6 py-3 rounded-xl shadow-2xl flex items-center gap-3'; icon.className = 'fas fa-exclamation-circle'; }
  else { div.className = 'bg-gradient-to-r from-emerald-600 to-teal-600 text-white px-6 py-3 rounded-xl shadow-2xl flex items-center gap-3'; icon.className = 'fas fa-check-circle'; }
  setTimeout(() => { toast.classList.add('toast-fade-out'); setTimeout(() => toast.classList.add('hidden'), 3000); }, 2800);
}

function triggerConfetti() {
  canvasConfetti({ particleCount: 150, spread: 80, origin: { y: 0.6 }, colors: ['#4f46e5', '#7c3aed'] });
  setTimeout(() => canvasConfetti({ particleCount: 100, spread: 100, origin: { y: 0.7, x: 0.2 } }), 200);
  setTimeout(() => canvasConfetti({ particleCount: 100, spread: 100, origin: { y: 0.7, x: 0.8 } }), 400);
}

function escapeHtml(str) { if (!str) return ''; return str.replace(/[&<>]/g, function(m) { if (m === '&') return '&amp;'; if (m === '<') return '&lt;'; if (m === '>') return '&gt;'; return m; }); }

function initializeEventListeners() {
  document.getElementById('unlockAdminBtn')?.addEventListener('click', () => {
    const s = document.getElementById('adminSecret').value;
    if (s) socket.emit('admin:unlock', { secret: s });
    else displayNotification('Enter secret code', 'error');
  });
  
  document.getElementById('createPollBtn')?.addEventListener('click', () => {
    const title = document.getElementById('newPollTitleInput').value;
    if (!title) { displayNotification('Enter poll title', 'error'); return; }
    socket.emit('poll:create', { title }, (response) => {
      if (response?.success) {
        displayNotification(`Poll created! Shareable link generated`, 'success');
        document.getElementById('shareLinkContainer').classList.remove('hidden');
        const link = `${window.location.origin}/poll/${response.pollId}`;
        document.getElementById('shareLinkInput').value = link;
        document.getElementById('newPollTitleInput').value = '';
        socket.emit('admin:get-polls', {}, (res) => { if (res?.polls) renderPollList(res.polls); });
      }
    });
  });
  
  document.getElementById('copyLinkBtn')?.addEventListener('click', () => {
    const input = document.getElementById('shareLinkInput');
    input.select();
    document.execCommand('copy');
    displayNotification('Link copied to clipboard!', 'success');
  });
  
  document.getElementById('setPollTitleBtn')?.addEventListener('click', () => {
    const title = document.getElementById('pollTitleInput').value;
    if (title) socket.emit('poll:update-title', { title });
  });
  
  document.getElementById('addCandidateBtn')?.addEventListener('click', () => {
    const name = document.getElementById('candidateName').value;
    if (!name) { displayNotification('Enter candidate name', 'error'); return; }
    socket.emit('candidate:add', { name, imageUrl: document.getElementById('candidateImage').value });
    document.getElementById('candidateName').value = '';
    document.getElementById('candidateImage').value = '';
  });
  
  document.getElementById('resetPollBtn')?.addEventListener('click', () => {
    if (confirm('Reset all votes for this poll?')) socket.emit('admin:reset-poll');
  });
  
  document.getElementById('deletePollBtn')?.addEventListener('click', () => {
    if (confirm('PERMANENTLY DELETE this poll? All data will be lost.')) {
      socket.emit('poll:delete', { pollId: currentEditPollId }, (response) => {
        if (response?.success) {
          displayNotification('Poll deleted', 'success');
          document.getElementById('editSection').classList.add('hidden');
          socket.emit('admin:get-polls', {}, (res) => { if (res?.polls) renderPollList(res.polls); });
        }
      });
    }
  });
  
  document.getElementById('revealResultsBtn')?.addEventListener('click', () => {
    if (confirm('Reveal results? Voting will close.')) socket.emit('admin:reveal-results');
  });
  
  document.getElementById('adminSecret')?.addEventListener('keypress', e => { if (e.key === 'Enter') document.getElementById('unlockAdminBtn')?.click(); });
}