const openFolder = document.querySelector('#open');
const refresh = document.querySelector('#refresh');
const workspace = document.querySelector('#workspace');
const feedback = document.querySelector('#feedback');
const results = document.querySelector('#results');

async function showReview(load) {
  openFolder.disabled = true;
  refresh.disabled = true;
  feedback.textContent = 'Reading Git changes…';
  try {
    const report = await load();
    if (report) {
      workspace.textContent = report.root;
      for (const field of ['status', 'staged', 'unstaged']) {
        document.getElementById(field).textContent = report[field] || 'None';
      }
      results.hidden = false;
    }
    feedback.textContent = '';
  } catch (error) {
    results.hidden = true;
    workspace.textContent = 'Choose a trusted Git repository to inspect local changes.';
    feedback.textContent = error.message;
  } finally {
    openFolder.disabled = false;
    refresh.disabled = results.hidden;
  }
}

openFolder.addEventListener('click', () => showReview(window.vertexReview.choose));
refresh.addEventListener('click', () => showReview(window.vertexReview.refresh));

const codingForm = document.querySelector('#coding');
const proposeButton = document.querySelector('#propose');
const codingFeedback = document.querySelector('#coding-feedback');
const proposal = document.querySelector('#proposal');

codingForm.addEventListener('submit', async event => {
  event.preventDefault();
  proposeButton.disabled = true;
  proposal.hidden = true;
  proposal.textContent = '';
  codingFeedback.textContent = 'Waiting for DeepSeek…';
  try {
    proposal.textContent = await window.vertexReview.propose({
      key: document.querySelector('#api-key').value.trim(),
      model: document.querySelector('#model').value,
      task: document.querySelector('#task').value,
      context: document.querySelector('#context').value,
    });
    proposal.hidden = false;
    codingFeedback.textContent = 'Proposal ready for review.';
  } catch (error) {
    codingFeedback.textContent = error.message;
  } finally {
    proposeButton.disabled = false;
  }
});
