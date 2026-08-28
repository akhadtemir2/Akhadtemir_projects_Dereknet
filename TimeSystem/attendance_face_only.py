import http.server
import socketserver
import json
import os
from datetime import datetime, time
from urllib.parse import urlparse, parse_qs
import base64
import pickle
import numpy as np
import io
from zoneinfo import ZoneInfo

TZ = ZoneInfo("Asia/Atyrau")

def now_local():
    return datetime.now(TZ).replace(tzinfo=None)

PORT = int(os.environ.get("PORT", 8000))
DATA_FILE = 'attendance.json'
FACES_FILE = 'faces_data.pkl'
WORK_START = time(14, 0)
WORK_END = time(17, 30)
ADMIN_PASSWORD = 'admin123'
FACE_DISTANCE_THRESHOLD = 0.40

os.environ.setdefault('TF_CPP_MIN_LOG_LEVEL', '3')
os.environ.setdefault('TF_ENABLE_ONEDNN_OPTS', '0')
os.environ.setdefault('CUDA_VISIBLE_DEVICES', '-1')

FACE_RECOGNITION_AVAILABLE = False
DeepFace = None

def _load_deepface():
    global DeepFace, FACE_RECOGNITION_AVAILABLE
    if FACE_RECOGNITION_AVAILABLE:
        return True
    try:
        from deepface import DeepFace as _DF
        DeepFace = _DF
        FACE_RECOGNITION_AVAILABLE = True
        print("DeepFace загружен успешно")
        return True
    except Exception as e:
        print(f"DeepFace failed to load: {type(e).__name__}: {e}")
        import traceback
        traceback.print_exc()
        return False

MAIN_HTML = r"""<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>SYNCHRONIZED | Time System</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<style>
:root {
  --bg: #000000;
  --card: #0a0a0a;
  --text: #ffffff;
  --muted: #9C9C9C;
  --accent: #a3e635;
  --border: #1a1a1a;
  --success: #a3e635;
  --error: #ff4444;
  --late: #ff8844;
  --vacation: #888888;
  --absent: #666666;
}
* { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Inter', sans-serif; }
body { 
  background: var(--bg); 
  min-height: 100vh; 
  display: flex; 
  justify-content: center;
  align-items: flex-start; 
  padding: 2rem 1rem;
  color: var(--text);
}
.card { 
  background: var(--card); 
  border: 1px solid var(--border);
  padding: 3rem; 
  width: 100%; 
  max-width: 680px;
  position: relative;
}
.card::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 1px;
  background: linear-gradient(90deg, transparent, var(--accent), transparent);
}
header { 
  display: flex; 
  justify-content: space-between; 
  align-items: flex-start; 
  margin-bottom: 3rem;
  border-bottom: 1px solid var(--border);
  padding-bottom: 1.5rem;
}
.logo-group { display: flex; flex-direction: column; gap: 0.5rem; }
.logo-small { font-size: 0.65rem; text-transform: uppercase; letter-spacing: 3px; color: var(--muted); }
.logo { font-size: 1.8rem; font-weight: 300; letter-spacing: -1px; text-transform: uppercase; }
.logo span { font-weight: 600; }
.timer { 
  font-size: 0.75rem; 
  color: var(--muted); 
  font-weight: 400; 
  text-transform: uppercase;
  letter-spacing: 2px;
  text-align: right;
}
.timer-value { 
  font-size: 1.4rem; 
  color: var(--text); 
  font-weight: 300;
  letter-spacing: -1px;
  margin-top: 0.25rem;
}
.hero-text { 
  font-size: 4rem; 
  font-weight: 200; 
  line-height: 0.95;
  letter-spacing: -3px;
  margin-bottom: 3rem;
  text-transform: uppercase;
}
.hero-text .line2 { 
  color: var(--muted);
  font-style: italic;
  font-weight: 300;
}
.cam-wrap { 
  position: relative; 
  background: var(--bg); 
  border: 1px solid var(--border);
  overflow: hidden; 
  aspect-ratio: 16/10; 
  margin-bottom: 1.5rem;
}
#video { width: 100%; height: 100%; object-fit: cover; display: block; }
#canvas { display: none; }
.cam-overlay { 
  position: absolute; 
  inset: 0; 
  display: flex; 
  flex-direction: column;
  align-items: center; 
  justify-content: center; 
  color: var(--muted); 
  gap: 1rem;
  border: 1px dashed var(--border);
  margin: 2rem;
}
.cam-overlay p { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 2px; }
.btn { 
  border: none; 
  cursor: pointer; 
  font-weight: 400;
  font-size: 0.75rem; 
  padding: 1.2rem 2rem; 
  transition: all 0.3s ease;
  text-transform: uppercase;
  letter-spacing: 2px;
  background: transparent;
}
.btn-primary { 
  background: var(--text); 
  color: var(--bg); 
  width: 100%; 
}
.btn-primary:hover { 
  background: var(--accent); 
  color: var(--bg);
}
.btn-primary:disabled { 
  background: var(--border); 
  color: var(--muted);
  cursor: not-allowed; 
}
.btn-secondary { 
  border: 1px solid var(--border);
  color: var(--muted); 
  width: 100%;
}
.btn-secondary:hover { 
  border-color: var(--text);
  color: var(--text);
}
#stepScan, #stepStatus, #stepDone { display: none; }
#stepScan.active, #stepStatus.active, #stepDone.active { display: block; }
.status-picker { 
  display: grid; 
  grid-template-columns: repeat(3, 1fr); 
  gap: 1rem;
  margin-bottom: 1.5rem;
}
.status-card { 
  background: transparent;
  border: 1px solid var(--border); 
  padding: 2rem 1rem; 
  text-align: center; 
  cursor: pointer; 
  transition: all 0.3s ease;
}
.status-card:hover { 
  border-color: var(--text); 
  background: rgba(255,255,255,0.02);
}
.status-card .label { 
  font-size: 0.7rem; 
  font-weight: 400; 
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 2px;
}
.status-card:hover .label { color: var(--text); }
.greeting { 
  font-size: 2rem; 
  font-weight: 200; 
  color: var(--text);
  margin-bottom: 2rem;
  letter-spacing: -1px;
}
.done-box { 
  text-align: center; 
  padding: 3rem 0;
  border: 1px solid var(--border);
}
.done-box .done-name { 
  font-size: 3rem; 
  font-weight: 200; 
  margin-bottom: 1rem;
  letter-spacing: -2px;
  text-transform: uppercase;
}
.done-box .done-status { 
  font-size: 0.85rem; 
  color: var(--muted); 
  margin-bottom: 2rem;
  text-transform: uppercase;
  letter-spacing: 2px;
}
.done-box.late .done-status { color: var(--late); }
.done-box.vacation .done-status { color: var(--vacation); }
.done-box.absent .done-status { color: var(--absent); }
.done-box.ok .done-status { color: var(--success); }
.msg { 
  padding: 1rem 1.5rem; 
  font-size: 0.75rem;
  text-align: center; 
  margin-bottom: 1rem;
  text-transform: uppercase;
  letter-spacing: 1px;
  border: 1px solid transparent;
}
.msg-error { 
  background: transparent;
  border-color: var(--error);
  color: var(--error); 
}
.msg-success { 
  background: transparent;
  border-color: var(--success);
  color: var(--success); 
}
.msg-info { 
  background: transparent;
  border-color: var(--border);
  color: var(--muted); 
}
.section-title { 
  font-size: 0.65rem; 
  text-transform: uppercase; 
  letter-spacing: 3px;
  color: var(--muted); 
  font-weight: 400; 
  margin: 3rem 0 1.5rem;
  display: flex;
  align-items: center;
  gap: 1rem;
}
.section-title::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--border);
}
.entry { 
  display: flex; 
  justify-content: space-between; 
  align-items: center;
  padding: 1.25rem 1.5rem;
  background: transparent;
  border: 1px solid var(--border);
  margin-bottom: 0.75rem;
  transition: all 0.3s ease;
}
.entry:hover { border-color: var(--muted); }
.entry .ename { 
  font-weight: 400; 
  display: flex; 
  align-items: center; 
  gap: 0.75rem;
  font-size: 0.95rem;
  text-transform: uppercase;
  letter-spacing: 1px;
}
.entry .ename .badge { 
  font-size: 0.55rem; 
  background: transparent;
  border: 1px solid var(--success);
  color: var(--success);
  padding: 0.2rem 0.5rem;
  text-transform: uppercase;
  letter-spacing: 1px;
}
.entry .einfo { text-align: right; }
.entry .etime { 
  font-size: 0.7rem; 
  color: var(--muted); 
  display: block;
  text-transform: uppercase;
  letter-spacing: 1px;
  margin-bottom: 0.25rem;
}
.entry .estats { 
  font-size: 0.75rem; 
  font-weight: 400;
  text-transform: uppercase;
  letter-spacing: 1px;
}
.ok { color: var(--success); }
.late2 { color: var(--late); }
.vac { color: var(--vacation); }
.abs { color: var(--absent); }
.empty-list { 
  text-align: center; 
  color: var(--muted); 
  padding: 3rem; 
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 2px;
  border: 1px dashed var(--border);
}
.admin-link { 
  display: block; 
  text-align: center; 
  margin-top: 3rem; 
  color: var(--muted);
  font-size: 0.65rem; 
  text-decoration: none;
  text-transform: uppercase;
  letter-spacing: 3px;
  transition: all 0.3s;
}
.admin-link:hover { color: var(--text); }
.nav-links {
  position: fixed;
  top: 2rem;
  right: 2rem;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  text-align: right;
}
.nav-links a {
  color: var(--muted);
  text-decoration: none;
  font-size: 0.65rem;
  text-transform: uppercase;
  letter-spacing: 2px;
  transition: color 0.3s;
}
.nav-links a:hover { color: var(--text); }
@media(max-width:768px) {
  .hero-text { font-size: 2.5rem; letter-spacing: -2px; }
  .done-box .done-name { font-size: 2rem; }
  .status-picker { grid-template-columns: 1fr; }
  .card { padding: 1.5rem 1rem; }
  .nav-links { display: none; }
}
@media(max-width:480px) {
  .hero-text { font-size: 2rem; letter-spacing: -1px; }
  header { flex-direction: column; gap: 1rem; }
  .timer { text-align: left; }
  .logo { font-size: 1.4rem; }
}
</style>
</head>
<body>
<div class="nav-links">
  <a href="/admin">Администратор</a>
</div>

<div class="card">
  <header>
    <div class="logo-group">
      <div class="logo-small">SYNCHRONIZED</div>
      <div class="logo">TIME <span>SYSTEM</span></div>
    </div>
    <div class="timer">
      <div>До конца смены</div>
      <div id="countdown" class="timer-value">--:--</div>
    </div>
  </header>

  <div class="hero-text">
    <div>FACE</div>
    <div class="line2">Recognition</div>
  </div>

  <div id="stepScan" class="active">
    <div class="cam-wrap">
      <video id="video" autoplay playsinline></video>
      <canvas id="canvas"></canvas>
      <div id="camPlaceholder" class="cam-overlay">
        <p>Включите камеру</p>
      </div>
    </div>
    <div id="scanMsg"></div>
    <button id="mainBtn" class="btn btn-primary" onclick="handleMainBtn()">Включить камеру</button>
  </div>

  <div id="stepStatus">
    <div id="greetingText" class="greeting"></div>
    <div class="status-picker">
      <div class="status-card" onclick="submitStatus('present')">
        <span class="label">Присутствие</span>
      </div>
      <div class="status-card" onclick="submitStatus('absent')">
        <span class="label">Отсутствие</span>
      </div>
      <div class="status-card" onclick="submitStatus('vacation')">
        <span class="label">Отпуск</span>
      </div>
    </div>
    <button class="btn btn-secondary" onclick="resetToScan()">Назад</button>
  </div>

  <div id="stepDone">
    <div id="doneBox" class="done-box">
      <div class="done-name" id="doneName"></div>
      <div class="done-status" id="doneStatusText"></div>
      <button class="btn btn-primary" onclick="resetToScan()">Готово</button>
    </div>
  </div>

  <div class="section-title">Сегодня</div>
  <div id="attendanceList"></div>

  <a href="/admin" class="admin-link">Панель администратора</a>
</div>

<script>
let videoStream = null;
let cameraActive = false;
let recognizedName = null;
let btnState = 'start';

function setStep(step) {
  ['stepScan','stepStatus','stepDone'].forEach(id => {
    document.getElementById(id).classList.remove('active');
  });
  document.getElementById('step' + step).classList.add('active');
}

function showMsg(elementId, text, type) {
  const el = document.getElementById(elementId);
  if (!el) return;
  el.className = 'msg msg-' + (type || 'info');
  el.innerHTML = text;
  el.style.display = text ? 'block' : 'none';
}

async function handleMainBtn() {
  if (btnState === 'start') {
    await startCamera();
  } else if (btnState === 'capture') {
    await captureFace();
  } else if (btnState === 'retry') {
    showMsg('scanMsg', '', 'info');
    setBtnState('capture');
  }
}

function setBtnState(state) {
  const btn = document.getElementById('mainBtn');
  btnState = state;
  if (state === 'start') {
    btn.textContent = 'Включить камеру';
    btn.disabled = false;
  } else if (state === 'capture') {
    btn.textContent = 'Сфотографировать и войти';
    btn.disabled = false;
  } else if (state === 'loading') {
    btn.textContent = 'Распознаю лицо...';
    btn.disabled = true;
  } else if (state === 'retry') {
    btn.textContent = 'Попробовать снова';
    btn.disabled = false;
  }
}

async function startCamera() {
  try {
    videoStream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' }
    });
    const video = document.getElementById('video');
    video.srcObject = videoStream;
    document.getElementById('camPlaceholder').style.display = 'none';
    cameraActive = true;
    setBtnState('capture');
    showMsg('scanMsg', 'Встаньте перед камерой и нажмите кнопку', 'info');
  } catch (err) {
    showMsg('scanMsg', 'Не удалось открыть камеру: ' + err.message, 'error');
  }
}

function stopCamera() {
  if (videoStream) {
    videoStream.getTracks().forEach(t => t.stop());
    videoStream = null;
  }
  const video = document.getElementById('video');
  video.srcObject = null;
  document.getElementById('camPlaceholder').style.display = 'flex';
  cameraActive = false;
}

async function captureFace() {
  const video = document.getElementById('video');
  const canvas = document.getElementById('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d').drawImage(video, 0, 0);
  const imageData = canvas.toDataURL('image/jpeg', 0.9);

  setBtnState('loading');
  showMsg('scanMsg', 'Распознаю...', 'info');

  try {
    const resp = await fetch('/api/identify-face', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: imageData })
    });
    const data = await resp.json();

    if (data.success) {
      recognizedName = data.name;
      stopCamera();
      showStatusStep(data.name, data.already_checked_in);
    } else {
      showMsg('scanMsg', data.message, 'error');
      setBtnState('retry');
    }
  } catch (err) {
    showMsg('scanMsg', 'Ошибка сети: ' + err.message, 'error');
    setBtnState('retry');
  }
}

function showStatusStep(name, alreadyCheckedIn) {
  if (alreadyCheckedIn) {
    showDoneStep(name, 'Уже отмечен сегодня', 'ok');
    return;
  }
  document.getElementById('greetingText').textContent = 'Привет, ' + name + '!';
  setStep('Status');
}

async function submitStatus(statusType) {
  if (!recognizedName) return;
  try {
    const resp = await fetch('/api/face-checkin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: recognizedName, status: statusType })
    });
    const data = await resp.json();
    if (data.error) {
      alert(data.error);
    } else {
      let cssClass = statusType === 'vacation' ? 'vacation'
                   : statusType === 'absent' ? 'absent'
                   : data.is_late ? 'late' : '';
      showDoneStep(recognizedName, data.status, cssClass);
      fetchStatus();
    }
  } catch (err) {
    alert('Ошибка: ' + err.message);
  }
}

function showDoneStep(name, statusText, cssClass) {
  document.getElementById('doneName').textContent = name;
  document.getElementById('doneStatusText').textContent = statusText;
  const box = document.getElementById('doneBox');
  box.className = 'done-box ' + (cssClass || '');
  setStep('Done');
  fetchStatus();
}

function resetToScan() {
  recognizedName = null;
  stopCamera();
  showMsg('scanMsg', '', 'info');
  setBtnState('start');
  setStep('Scan');
}

async function fetchStatus() {
  try {
    const resp = await fetch('/api/status');
    const data = await resp.json();
    const el = document.getElementById('attendanceList');
    if (!data.length) {
      el.innerHTML = '<div class="empty-list">Пока никого нет...</div>';
      return;
    }
    el.innerHTML = data.map(e => {
      let cls = e.is_late ? 'late2' : e.type === 'vacation' ? 'vac'
              : e.type === 'absent' ? 'abs' : 'ok';
      return `<div class="entry">
        <div class="ename">${e.name} <span class="badge">верифицирован</span></div>
        <div class="einfo">
          <span class="etime">${e.time}</span>
          <span class="estats ${cls}">${e.status}</span>
        </div>
      </div>`;
    }).join('');
  } catch (err) { console.error(err); }
}

async function updateTimer() {
  try {
    const resp = await fetch('/api/time_left');
    const data = await resp.json();
    const el = document.getElementById('countdown');
    if (data.finished) {
      el.textContent = 'День окончен';
      el.style.color = '#aaa';
    } else {
      el.textContent = 'До конца: ' + data.time_left;
      el.style.color = 'var(--accent)';
    }
  } catch(e) {}
}

fetchStatus();
updateTimer();
setInterval(updateTimer, 1000);
setInterval(fetchStatus, 20000);
</script>
</body>
</html>
"""

ADMIN_HTML = r"""<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>SYNCHRONIZED | Администратор</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<style>
:root { 
  --bg:#000000; 
  --card:#0a0a0a; 
  --text:#ffffff; 
  --muted:#9C9C9C; 
  --accent:#a3e635;
  --border:#1a1a1a;
  --success:#a3e635; 
  --error:#ff4444; 
}
* { box-sizing:border-box; margin:0; padding:0; font-family:'Inter',sans-serif; }
body { 
  background:var(--bg); 
  min-height:100vh; 
  display:flex; 
  justify-content:center;
  align-items:flex-start; 
  padding:2rem 1rem;
  color: var(--text);
}
.card { 
  background:var(--card); 
  border: 1px solid var(--border);
  padding:3rem; 
  width:100%; 
  max-width:680px;
  position: relative;
}
.card::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 1px;
  background: linear-gradient(90deg, transparent, var(--accent), transparent);
}
h1 { 
  font-size:2.5rem; 
  font-weight:200; 
  margin-bottom:0.5rem;
  letter-spacing: -2px;
  text-transform: uppercase;
}
.subtitle { 
  color:var(--muted); 
  font-size:0.75rem; 
  margin-bottom:3rem;
  text-transform: uppercase;
  letter-spacing: 2px;
}
.section-title { 
  font-size:0.65rem; 
  text-transform:uppercase; 
  letter-spacing:3px;
  color:var(--muted); 
  font-weight:400; 
  margin:3rem 0 1.5rem;
  display: flex;
  align-items: center;
  gap: 1rem;
}
.section-title::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--border);
}
input[type=text], input[type=password] {
  width:100%; 
  padding:1.2rem 1.5rem; 
  border:1px solid var(--border); 
  font-size:0.9rem; 
  outline:none; 
  transition:all .3s; 
  background:transparent; 
  margin-bottom:1rem;
  color: var(--text);
  text-transform: uppercase;
  letter-spacing: 1px;
}
input::placeholder { color: var(--muted); }
input:focus { 
  border-color:var(--text); 
}
.btn { 
  border:none; 
  cursor:pointer; 
  font-weight:400; 
  font-size:0.75rem;
  padding:1.2rem 2rem; 
  transition:all .3s ease;
  text-transform: uppercase;
  letter-spacing: 2px;
  background: transparent;
}
.btn-primary { 
  background:var(--text); 
  color:var(--bg); 
  width:100%; 
}
.btn-primary:hover { 
  background:var(--accent); 
}
.btn-primary:disabled { 
  background:var(--border); 
  color:var(--muted);
  cursor:not-allowed; 
}
.btn-danger { 
  border: 1px solid var(--error);
  color:var(--error); 
  padding:.8rem 1.5rem; 
  font-size:.7rem;
  background: transparent;
}
.btn-danger:hover { 
  background: var(--error);
  color: var(--bg);
}
.cam-wrap { 
  background:var(--bg); 
  border: 1px solid var(--border);
  overflow:hidden; 
  aspect-ratio:16/10;
  margin-bottom:1.5rem;
}
#adminVideo { width:100%; height:100%; object-fit:cover; display:block; }
.msg { 
  padding:1rem 1.5rem; 
  font-size:0.75rem; 
  text-align:center;
  margin-bottom:1rem; 
  display:none;
  text-transform: uppercase;
  letter-spacing: 1px;
  border: 1px solid transparent;
}
.msg-error { 
  background: transparent;
  border-color: var(--error);
  color:var(--error); 
}
.msg-success { 
  background: transparent;
  border-color: var(--success);
  color:var(--success); 
}
.msg-info { 
  background: transparent;
  border-color: var(--border);
  color:var(--muted); 
}
.emp-row { 
  display:flex; 
  align-items:center; 
  justify-content:space-between;
  padding:1.25rem 1.5rem;
  background:transparent;
  border:1px solid var(--border); 
  margin-bottom:.75rem;
  transition: all 0.3s;
}
.emp-row:hover { border-color: var(--muted); }
.emp-name { 
  font-weight:400;
  text-transform: uppercase;
  letter-spacing: 1px;
  font-size: 0.95rem;
}
#adminSection { display:none; }
.back-link { 
  display:block; 
  text-align:center; 
  margin-top:3rem; 
  color:var(--muted);
  font-size:.65rem; 
  text-decoration:none;
  text-transform: uppercase;
  letter-spacing: 3px;
  transition: all 0.3s;
}
.back-link:hover { color:var(--text); }
.two-col { display:grid; grid-template-columns:1fr 1fr; gap:1rem; }
.nav-links {
  position: fixed;
  top: 2rem;
  right: 2rem;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  text-align: right;
}
.nav-links a {
  color: var(--muted);
  text-decoration: none;
  font-size: 0.65rem;
  text-transform: uppercase;
  letter-spacing: 2px;
  transition: color 0.3s;
}
.nav-links a:hover { color: var(--text); }
@media(max-width:768px) {
  .two-col { grid-template-columns:1fr; }
  .card { padding: 1.5rem 1rem; }
  h1 { font-size: 1.8rem; }
  .nav-links { display: none; }
}
@media(max-width:480px) {
  h1 { font-size: 1.5rem; letter-spacing: -1px; }
}
</style>
</head>
<body>
<div class="nav-links">
  <a href="/">Главная</a>
</div>

<div class="card">
  <h1>Администратор</h1>
  <p class="subtitle">Управление сотрудниками и регистрация лиц</p>

  <div id="loginSection">
    <div class="section-title">Вход</div>
    <input type="password" id="pwInput" placeholder="Пароль администратора..."
           onkeydown="if(event.key==='Enter')adminLogin()">
    <div id="loginMsg" class="msg"></div>
    <button class="btn btn-primary" onclick="adminLogin()">Войти</button>
  </div>

  <div id="adminSection">
    <div class="section-title">Зарегистрировать сотрудника</div>
    <input type="text" id="regName" placeholder="Имя сотрудника...">
    <div class="cam-wrap">
      <video id="adminVideo" autoplay playsinline></video>
    </div>
    <div id="regMsg" class="msg"></div>
    <div class="two-col">
      <button id="adminCamBtn" class="btn btn-primary" onclick="toggleAdminCam()">Включить камеру</button>
      <button id="adminCaptureBtn" class="btn btn-primary" disabled onclick="captureAndRegister()">
        Зарегистрировать
      </button>
    </div>

    <div class="section-title">Зарегистрированные сотрудники</div>
    <div id="employeeList"></div>
  </div>

  <a href="/" class="back-link">Вернуться к главной</a>
</div>

<script>
let adminPwd = '';
let adminStream = null;
let adminCamOn = false;

function showMsg(id, text, type) {
  const el = document.getElementById(id);
  el.className = 'msg msg-' + (type || 'info');
  el.textContent = text;
  el.style.display = text ? 'block' : 'none';
}

async function adminLogin() {
  const pw = document.getElementById('pwInput').value;
  const resp = await fetch('/api/admin/auth', {
    method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({password: pw})
  });
  const data = await resp.json();
  if (data.success) {
    adminPwd = pw;
    document.getElementById('loginSection').style.display = 'none';
    document.getElementById('adminSection').style.display = 'block';
    loadEmployees();
  } else {
    showMsg('loginMsg', 'Неверный пароль', 'error');
  }
}

async function toggleAdminCam() {
  if (!adminCamOn) {
    try {
      adminStream = await navigator.mediaDevices.getUserMedia({ video: true });
      document.getElementById('adminVideo').srcObject = adminStream;
      adminCamOn = true;
      document.getElementById('adminCamBtn').textContent = 'Выключить камеру';
      document.getElementById('adminCaptureBtn').disabled = false;
    } catch(e) { showMsg('regMsg', e.message, 'error'); }
  } else {
    adminStream.getTracks().forEach(t => t.stop());
    document.getElementById('adminVideo').srcObject = null;
    adminCamOn = false;
    document.getElementById('adminCamBtn').textContent = 'Включить камеру';
    document.getElementById('adminCaptureBtn').disabled = true;
  }
}

async function captureAndRegister() {
  const name = document.getElementById('regName').value.trim();
  if (!name) { showMsg('regMsg', 'Введите имя сотрудника', 'error'); return; }
  if (!adminCamOn) { showMsg('regMsg', 'Включите камеру', 'error'); return; }

  const video = document.getElementById('adminVideo');
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d').drawImage(video, 0, 0);
  const imageData = canvas.toDataURL('image/jpeg', 0.9);

  showMsg('regMsg', 'Регистрирую...', 'info');
  const resp = await fetch('/api/admin/register-face', {
    method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ name, image: imageData, password: adminPwd })
  });
  const data = await resp.json();
  if (data.success) {
    showMsg('regMsg', data.message, 'success');
    document.getElementById('regName').value = '';
    loadEmployees();
  } else {
    showMsg('regMsg', data.message, 'error');
  }
}

async function loadEmployees() {
  const resp = await fetch('/api/admin/employees?password=' + encodeURIComponent(adminPwd));
  const data = await resp.json();
  const el = document.getElementById('employeeList');
  if (!data.employees || !data.employees.length) {
    el.innerHTML = '<div style="color:var(--muted);text-align:center;padding:1.5rem">Нет зарегистрированных сотрудников</div>';
    return;
  }
  el.innerHTML = data.employees.map(name => `
    <div class="emp-row">
      <div class="emp-name">${name}</div>
      <button class="btn btn-danger" onclick="deleteEmployee('${name}')">Удалить</button>
    </div>
  `).join('');
}

async function deleteEmployee(name) {
  if (!confirm('Удалить сотрудника ' + name + '?')) return;
  const resp = await fetch('/api/admin/delete-employee', {
    method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ name, password: adminPwd })
  });
  const data = await resp.json();
  if (data.success) loadEmployees();
  else alert(data.message);
}
</script>
</body>
</html>
"""


def load_data():
    if not os.path.exists(DATA_FILE):
        return {}
    with open(DATA_FILE, 'r', encoding='utf-8') as f:
        return json.load(f)

def save_data(data):
    with open(DATA_FILE, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=4, ensure_ascii=False)

def load_faces():
    if not os.path.exists(FACES_FILE):
        return {}
    try:
        with open(FACES_FILE, 'rb') as f:
            return pickle.load(f)
    except Exception:
        return {}

def save_faces(faces):
    with open(FACES_FILE, 'wb') as f:
        pickle.dump(faces, f)

def save_temp_image(image_base64):
    from PIL import Image
    raw = base64.b64decode(image_base64.split(',')[1] if ',' in image_base64 else image_base64)
    img = Image.open(io.BytesIO(raw)).convert('RGB')
    tmp_path = os.path.join(os.path.dirname(DATA_FILE) or '.', '_tmp_face.jpg')
    img.save(tmp_path, 'JPEG', quality=90)
    return tmp_path

def get_embedding(image_base64):
    if not _load_deepface():
        return None, "DeepFace не установлен"
    tmp = save_temp_image(image_base64)
    try:
        result = DeepFace.represent(
            img_path=tmp,
            model_name='Facenet',
            enforce_detection=True,
            detector_backend='opencv'
        )
        if not result:
            return None, "Лицо не обнаружено"
        return np.array(result[0]['embedding']), None
    except Exception as e:
        msg = str(e)
        if 'Face could not be detected' in msg or 'cannot detect' in msg.lower():
            return None, "Лицо не обнаружено. Встаньте прямо, обеспечьте хорошее освещение."
        return None, f"Ошибка: {msg}"
    finally:
        try:
            os.remove(tmp)
        except Exception:
            pass

def cosine_distance(a, b):
    a = a / (np.linalg.norm(a) + 1e-9)
    b = b / (np.linalg.norm(b) + 1e-9)
    return float(1.0 - np.dot(a, b))

def register_face(name, image_base64):
    if not _load_deepface():
        return False, "deepface не установлен. Запустите: pip install deepface Pillow numpy tf-keras"
    embedding, err = get_embedding(image_base64)
    if embedding is None:
        return False, err or "Лицо не найдено на фото. Встаньте ближе к камере."
    faces = load_faces()
    faces[name.lower()] = {
        'display_name': name,
        'encoding': embedding.tolist()
    }
    save_faces(faces)
    return True, f'Сотрудник "{name}" зарегистрирован'

def identify_face(image_base64):
    if not _load_deepface():
        return False, "deepface не установлен. Запустите: pip install deepface Pillow numpy tf-keras", None
    embedding, err = get_embedding(image_base64)
    if embedding is None:
        return False, err or "Лицо не обнаружено.", None
    faces = load_faces()
    if not faces:
        return False, "В системе нет зарегистрированных сотрудников. Обратитесь к администратору.", None

    best_name = None
    best_dist = float('inf')
    for key, val in faces.items():
        dist = cosine_distance(embedding, np.array(val['encoding']))
        if dist < best_dist:
            best_dist = dist
            best_name = key

    if best_dist <= FACE_DISTANCE_THRESHOLD:
        display = faces[best_name]['display_name']
        return True, f"Распознан: {display}", display
    return False, "Лицо не совпадает с базой. Вы зарегистрированы в системе?", None


class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass

    def _json(self, status, data):
        body = json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.end_headers()
        self.wfile.write(body)

    def _html(self, content, status=200):
        body = content.encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self):
        length = int(self.headers.get('Content-Length', 0))
        raw = self.rfile.read(length)
        return json.loads(raw.decode('utf-8'))

    def do_GET(self):
        p = urlparse(self.path).path

        if p == '/':
            self._html(MAIN_HTML)
        elif p == '/admin':
            self._html(ADMIN_HTML)
        elif p == '/api/status':
            today = now_local().strftime('%Y-%m-%d')
            data = load_data()
            self._json(200, data.get(today, []))
        elif p == '/api/time_left':
            now = now_local()
            end_dt = datetime.combine(now.date(), WORK_END)
            if now > end_dt:
                self._json(200, {'time_left': 'Рабочий день окончен', 'finished': True})
            else:
                diff = end_dt - now
                h, rem = divmod(int(diff.total_seconds()), 3600)
                m, s = divmod(rem, 60)
                self._json(200, {'time_left': f'{h:02d}:{m:02d}:{s:02d}', 'finished': False})
        elif p.startswith('/api/admin/employees'):
            qs = parse_qs(urlparse(self.path).query)
            pw = qs.get('password', [''])[0]
            if pw != ADMIN_PASSWORD:
                self._json(403, {'error': 'Неверный пароль'})
                return
            faces = load_faces()
            names = [faces[k]['display_name'] for k in faces]
            self._json(200, {'employees': names})
        else:
            self._html('<h1>404</h1>', 404)

    def do_POST(self):
        p = urlparse(self.path).path

        if p == '/api/identify-face':
            payload = self._read_json()
            image = payload.get('image', '')
            success, message, name = identify_face(image)
            if not success:
                self._json(200, {'success': False, 'message': message})
                return
            today = now_local().strftime('%Y-%m-%d')
            data = load_data()
            already = any(e['name'].lower() == name.lower() for e in data.get(today, []))
            self._json(200, {'success': True, 'name': name, 'already_checked_in': already})

        elif p == '/api/face-checkin':
            payload = self._read_json()
            name = payload.get('name', '').strip()
            status_type = payload.get('status', 'present')
            if not name:
                self._json(400, {'error': 'Имя не передано'})
                return
            now = now_local()
            today = now.strftime('%Y-%m-%d')
            data = load_data()
            data.setdefault(today, [])
            for entry in data[today]:
                if entry['name'].lower() == name.lower():
                    self._json(400, {'error': 'Уже отмечен сегодня'})
                    return
            is_late = False
            if status_type == 'present':
                start_dt = datetime.combine(now.date(), WORK_START)
                is_late = now > start_dt
                late_min = int((now - start_dt).total_seconds() / 60)
                status_text = f'Опоздал на {late_min} мин.' if is_late else 'Вовремя'
            elif status_type == 'absent':
                status_text = 'Не придет'
            else:
                status_text = 'В отпуске'
            entry = {
                'name': name,
                'time': now.strftime('%H:%M'),
                'status': status_text,
                'type': status_type,
                'is_late': is_late,
                'verified': True
            }
            data[today].append(entry)
            save_data(data)
            self._json(200, entry)

        elif p == '/api/admin/auth':
            payload = self._read_json()
            ok = payload.get('password') == ADMIN_PASSWORD
            self._json(200, {'success': ok})

        elif p == '/api/admin/register-face':
            payload = self._read_json()
            if payload.get('password') != ADMIN_PASSWORD:
                self._json(403, {'success': False, 'message': 'Неверный пароль'})
                return
            name = payload.get('name', '').strip()
            image = payload.get('image', '')
            if not name:
                self._json(400, {'success': False, 'message': 'Введите имя'})
                return
            ok, msg = register_face(name, image)
            self._json(200, {'success': ok, 'message': msg})

        elif p == '/api/admin/delete-employee':
            payload = self._read_json()
            if payload.get('password') != ADMIN_PASSWORD:
                self._json(403, {'success': False, 'message': 'Неверный пароль'})
                return
            name = payload.get('name', '').strip().lower()
            faces = load_faces()
            deleted = False
            for key in list(faces.keys()):
                if key.lower() == name:
                    del faces[key]
                    deleted = True
                    break
            if deleted:
                save_faces(faces)
                self._json(200, {'success': True})
            else:
                self._json(404, {'success': False, 'message': 'Сотрудник не найден'})

        else:
            self._html('<h1>404</h1>', 404)


if __name__ == '__main__':
    print(f"Веб-сервер запущен на порту {PORT}")

    with socketserver.TCPServer(('0.0.0.0', PORT), Handler) as httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass
