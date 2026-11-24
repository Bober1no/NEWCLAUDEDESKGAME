/* Learn page quiz. */
(function () {
  const { esc } = FD;
  const Q = [
    ['You buy a GPU for $200 and sell it for $300. What is your gross profit?', ['$50', '$100', '$200', '$300'], 1, '$300 − $200 = $100, before other costs.'],
    ['You make $100 profit on a $400 investment. What is your ROI?', ['10%', '20%', '25%', '40%'], 2, '100 ÷ 400 × 100 = 25%.'],
    ['Same GPU: bought $200, sold $300. What is the gross margin?', ['50%', '33.3%', '25%', '66.7%'], 1, 'Margin = profit ÷ sale price = 100 ÷ 300. (50% is the markup.)'],
    ['You have $3,000 in inventory but only $100 in cash. What is the main concern?', ['Revenue', 'Liquidity', 'Markup', 'Market share'], 1, 'You may be profitable on paper but can\'t pay expenses or buy new stock.'],
    ['A GPU has a 10% chance of costing you $200. What does that add to expected loss?', ['$2', '$10', '$20', '$200'], 2, '0.10 × $200 = $20 per purchase.'],
    ['Your PC hasn\'t sold after 30 days. You paid $700. Realistic resale is now $550. What should guide your decision?', ['Get the $700 back at all costs', 'Keep waiting indefinitely', 'Compare the outcomes from today onwards and pick the best one', 'Spend $200 on ads automatically'], 2, 'The $700 is a sunk cost. Only future outcomes matter.'],
    ['Expected sale $800, repairs $30, selling costs $20, target profit $150, risk allowance $50. Max buy?', ['$650', '$600', '$550', '$500'], 2, '800 − 30 − 20 − 150 − 50 = $550. If they want $650, walk away.'],
    ['Which price should you value an item on?', ['Highest asking price', 'Average asking price', 'Recent sold (transaction) prices', 'What you paid'], 2, 'Asking prices are hopes. Sold prices are evidence.'],
    ['Deal A: 15% ROI in 5 days. Deal B: 30% ROI in 60 days. Which uses capital better, if you can repeat it?', ['A', 'B', 'Same', 'Can\'t tell'], 0, 'A can be done about 12 times while B is done once. Time matters as much as the return.'],
    ['You lose $50 on every third GPU. What should you do before buying 10× more?', ['Scale up, volume fixes it', 'Fix the process first', 'Raise prices on everything', 'Stop logging losses'], 1, 'Don\'t scale a broken business. It just makes the losses bigger.'],
  ];
  const answers = {};

  function render() {
    const box = document.getElementById('quizBox');
    const done = Object.keys(answers).length;
    const right = Object.entries(answers).filter(([i, a]) => Q[i][2] === a).length;
    box.innerHTML = Q.map(([q, opts, correct, why], i) => {
      const a = answers[i];
      return `<div class="quiz-q"><strong>${i + 1}. ${esc(q)}</strong><div class="opts">${opts.map((o, j) => {
        let cls = '';
        if (a !== undefined) { if (j === correct) cls = 'right'; else if (j === a) cls = 'wrong'; }
        return `<button type="button" class="opt ${cls}" data-q="${i}" data-a="${j}" ${a !== undefined ? 'disabled' : ''}>${esc(o)}</button>`;
      }).join('')}</div>${a !== undefined ? `<div class="explain">${a === correct ? '<span class="pos">Correct.</span>' : '<span class="neg">Incorrect.</span>'} ${esc(why)}</div>` : ''}</div>`;
    }).join('') + `<div class="btn-row mt"><strong>${right}/${Q.length} correct</strong> <span class="muted">(${done} answered)</span> <button class="btn btn-sm" type="button" id="quizReset">Try again</button></div>`;
  }

  document.addEventListener('click', (e) => {
    const b = e.target.closest('.opt');
    if (b) { answers[b.dataset.q] = +b.dataset.a; render(); }
    if (e.target.id === 'quizReset') { Object.keys(answers).forEach((k) => delete answers[k]); render(); }
  });
  document.addEventListener('DOMContentLoaded', render);
})();
