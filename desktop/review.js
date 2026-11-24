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
