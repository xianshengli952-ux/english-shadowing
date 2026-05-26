'use strict';

const ocr = (() => {
  let worker = null;

  async function init() {
    if (worker) return;
    try {
      worker = await Tesseract.createWorker('eng', 1, {
        logger: m => {
          if (m.status === 'recognizing text') {
            const pct = Math.round(m.progress * 100);
            updateOcrStatus('Recognizing text... ' + pct + '%');
          }
        }
      });
    } catch (err) {
      throw new Error('Failed to load OCR engine: ' + err.message);
    }
  }

  async function recognize(imageElement) {
    await init();
    const { data } = await worker.recognize(imageElement);
    return data;
  }

  function extractSentences(ocrData) {
    const paragraphs = ocrData.paragraphs || [];
    const sentences = [];
    for (const para of paragraphs) {
      const lines = para.lines || [];
      for (const line of lines) {
        const text = line.text.trim();
        if (text && /[a-zA-Z]/.test(text)) {
          sentences.push(text);
        }
      }
    }
    return sentences;
  }

  async function terminate() {
    if (worker) {
      await worker.terminate();
      worker = null;
    }
  }

  return { init, recognize, extractSentences, terminate };
})();

const tts = (() => {
  function speak(text) {
    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-US';
    utterance.rate = 0.9;
    speechSynthesis.speak(utterance);
    return utterance;
  }

  function stop() {
    speechSynthesis.cancel();
  }

  return { speak, stop };
})();

const recorder = (() => {
  let mediaRecorder = null;
  let audioChunks = [];
  let audioBlob = null;
  let audioUrl = null;
  let timerInterval = null;
  let startTime = 0;

  async function start() {
    audioChunks = [];
    audioBlob = null;
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
      audioUrl = null;
    }

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeType = ['audio/webm', 'audio/mp4', 'audio/ogg']
      .find(t => MediaRecorder.isTypeSupported(t)) || '';
    mediaRecorder = new MediaRecorder(stream, { mimeType });

    mediaRecorder.ondataavailable = e => {
      if (e.data.size > 0) audioChunks.push(e.data);
    };

    mediaRecorder.onstop = () => {
      stream.getTracks().forEach(t => t.stop());
      audioBlob = new Blob(audioChunks, { type: mimeType || 'audio/webm' });
      audioUrl = URL.createObjectURL(audioBlob);
      btnRecord.classList.remove('recording');
      btnPlayback.disabled = false;
    };

    mediaRecorder.start();
    startTimer();
  }

  function stop() {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      mediaRecorder.stop();
    }
    stopTimer();
  }

  function play() {
    if (!audioUrl) return;
    const audio = new Audio(audioUrl);
    audio.play();
  }

  function startTimer() {
    startTime = Date.now();
    recordingTimer.classList.remove('hidden');
    timerInterval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      const mins = String(Math.floor(elapsed / 60)).padStart(2, '0');
      const secs = String(elapsed % 60).padStart(2, '0');
      recordingTimer.textContent = mins + ':' + secs;
    }, 200);
  }

  function stopTimer() {
    clearInterval(timerInterval);
    recordingTimer.classList.add('hidden');
  }

  function reset() {
    stop();
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
      audioUrl = null;
    }
    audioBlob = null;
    btnPlayback.disabled = true;
    btnRecord.classList.remove('recording');
  }

  return { start, stop, play, reset };
})();

function resetRecording() {
  recorder.reset();
}

const $ = id => document.getElementById(id);
const btnCamera = $('btn-camera');
const btnUpload = $('btn-upload');
const fileInput = $('file-input');
const imagePreview = $('image-preview');
const sourceImage = $('source-image');
const btnRemoveImage = $('btn-remove-image');
const ocrStatus = $('ocr-status');
const sentenceArea = $('sentence-area');
const placeholderMsg = $('placeholder-message');
const btnRecord = $('btn-record');
const btnPlayback = $('btn-playback');
const recordingTimer = $('recording-timer');

function updateOcrStatus(msg) {
  ocrStatus.classList.remove('hidden');
  ocrStatus.querySelector('p').textContent = msg;
}

function hideOcrStatus() {
  ocrStatus.classList.add('hidden');
}

let currentObjectURL = null;

btnCamera.addEventListener('click', () => {
  fileInput.click();
});

btnUpload.addEventListener('click', () => {
  fileInput.removeAttribute('capture');
  fileInput.click();
  fileInput.setAttribute('capture', 'environment');
});

fileInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  await loadImage(file);
});

btnRemoveImage.addEventListener('click', () => {
  if (currentObjectURL) {
    URL.revokeObjectURL(currentObjectURL);
    currentObjectURL = null;
  }
  sourceImage.src = '';
  imagePreview.classList.add('hidden');
  sentenceArea.innerHTML = '';
  sentenceArea.appendChild(placeholderMsg);
  placeholderMsg.classList.remove('hidden');
  fileInput.value = '';
  currentSentenceIndex = -1;
  tts.stop();
  ocr.terminate().catch(() => {});
});

async function loadImage(file) {
  if (currentObjectURL) {
    URL.revokeObjectURL(currentObjectURL);
    currentObjectURL = null;
  }
  const url = URL.createObjectURL(file);
  currentObjectURL = url;
  sourceImage.src = url;
  imagePreview.classList.remove('hidden');
  placeholderMsg.classList.add('hidden');

  updateOcrStatus('Recognizing text...');
  try {
    const data = await ocr.recognize(sourceImage);
    const sentences = ocr.extractSentences(data);
    hideOcrStatus();
    renderSentences(sentences);
  } catch (err) {
    hideOcrStatus();
    showError('OCR failed: ' + err.message);
  }
}

function showError(msg) {
  document.querySelectorAll('.error-banner').forEach(b => b.remove());
  const banner = document.createElement('div');
  banner.className = 'error-banner';
  banner.textContent = msg;
  sentenceArea.prepend(banner);
  setTimeout(() => banner.remove(), 5000);
}

let currentSentenceIndex = -1;

function renderSentences(sentences) {
  sentenceArea.innerHTML = '';

  if (sentences.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'No English text detected in the image';
    sentenceArea.appendChild(empty);
    return;
  }

  sentences.forEach((text, i) => {
    const card = document.createElement('div');
    card.className = 'sentence-card';
    card.textContent = text;
    const icon = document.createElement('span');
    icon.className = 'play-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = '\u{1F50A}';
    card.appendChild(icon);
    card.addEventListener('click', () => selectSentence(i, text));
    sentenceArea.appendChild(card);
  });
}

function selectSentence(index, text) {
  currentSentenceIndex = index;

  document.querySelectorAll('.sentence-card').forEach((c, i) => {
    c.classList.toggle('active', i === index);
  });

  resetRecording();
  tts.speak(text);
}

let isRecording = false;

btnRecord.addEventListener('click', async () => {
  if (isRecording) {
    recorder.stop();
    isRecording = false;
    return;
  }

  if (currentSentenceIndex === -1) {
    showError('Tap a sentence first to select it');
    return;
  }

  try {
    await recorder.start();
    isRecording = true;
    btnRecord.classList.add('recording');
    btnPlayback.disabled = true;
  } catch (err) {
    showError('Microphone access denied. Please allow microphone permission.');
  }
});

btnPlayback.addEventListener('click', () => {
  recorder.play();
});

sentenceArea.addEventListener('click', (e) => {
  if (e.target.classList.contains('error-banner')) {
    e.target.remove();
  }
});
