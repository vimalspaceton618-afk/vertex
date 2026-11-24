const openFolder = document.querySelector('#open');
const refresh = document.querySelector('#refresh');
const workspace = document.querySelector('#workspace');
const feedback = document.querySelector('#feedback');
const results = document.querySelector('#results');

async function showReview(load) {
  lockCoding(true);
  feedback.textContent = 'Reading Git changes…';
  try {
    const report = await load();
    if (report) {
      workspace.textContent = report.root;
      if (load === window.vertexReview.choose) setSource(null);
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
    lockCoding(false);
  }
}

openFolder.addEventListener('click', () => showReview(window.vertexReview.choose));
refresh.addEventListener('click', () => showReview(window.vertexReview.refresh));

const codingForm = document.querySelector('#coding');
const proposeButton = document.querySelector('#propose');
const codingFeedback = document.querySelector('#coding-feedback');
const proposal = document.querySelector('#proposal');
const context = document.querySelector('#context');
const contextLabel = document.querySelector('#context-label');
const chooseFile = document.querySelector('#choose-file');
const usePaste = document.querySelector('#use-paste');
const editPanel = document.querySelector('#edit');
const applyButton = document.querySelector('#apply-edit');
let selectedFile = null;
chooseFile.disabled = true;

function setSource(file) {
  selectedFile = file;
  contextLabel.textContent = file ? file.name : 'Source code and file paths';
  context.readOnly = Boolean(file);
  context.value = file?.text ?? '';
  usePaste.hidden = !file;
  editPanel.hidden = true;
  proposal.hidden = true;
  codingFeedback.textContent = '';
}

function lockCoding(locked) {
  proposeButton.disabled = locked;
  chooseFile.disabled = locked || results.hidden;
  openFolder.disabled = locked;
  refresh.disabled = locked || results.hidden;
  usePaste.disabled = locked;
  applyButton.disabled = locked;
}

chooseFile.addEventListener('click', async () => {
  lockCoding(true);
  try {
    const file = await window.vertexReview.chooseFile();
    if (file) setSource(file);
  } catch (error) {
    codingFeedback.textContent = error.message;
  } finally {
    lockCoding(false);
  }
});
usePaste.addEventListener('click', () => setSource(null));

codingForm.addEventListener('submit', async event => {
  event.preventDefault();
  lockCoding(true);
  editPanel.hidden = true;
  proposal.hidden = true;
  codingFeedback.textContent = 'Waiting for DeepSeek…';
  try {
    const result = await window.vertexReview.propose({
      key: document.querySelector('#api-key').value.trim(),
      model: document.querySelector('#model').value,
      task: document.querySelector('#task').value,
      context: selectedFile ? undefined : context.value,
      useFile: Boolean(selectedFile),
    });
    proposal.textContent = result.text ?? result.summary;
    proposal.hidden = !proposal.textContent;
    if (result.name) {
      document.querySelector('#before-edit').textContent = result.find;
      document.querySelector('#after-edit').textContent = result.replacement;
      editPanel.hidden = false;
    }
    codingFeedback.textContent = 'Proposal ready for review.';
  } catch (error) {
    codingFeedback.textContent = error.message;
  } finally {
    lockCoding(false);
  }
});

applyButton.addEventListener('click', async () => {
  lockCoding(true);
  try {
    if (await window.vertexReview.applyEdit()) {
      setSource(null);
      await showReview(window.vertexReview.refresh);
      codingFeedback.textContent = 'Edit applied. Review the workspace diff below.';
    }
  } catch (error) {
    editPanel.hidden = true;
    codingFeedback.textContent = error.message;
  } finally {
    lockCoding(false);
  }
});
