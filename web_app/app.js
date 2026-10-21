/**
 * ====================================================================
 * SMART HOME AI - 3-SCENE WEB SERIAL & MEDIAPIPE GESTURE CONTROLLER
 * Workflow: Scene 1 (Face ID Gate) -> Scene 2 (Hand Gestures) | Scene 3 (Alarm)
 * ====================================================================
 */

// --------------------------------------------------------------------
// 1. STATE MANAGEMENT
// --------------------------------------------------------------------
const state = {
    currentScene: 1, // 1: Face Gate | 2: Hand Gestures | 3: Alarm
    
    // Hardware Serial State
    port: null,
    reader: null,
    writer: null,
    isSerialConnected: false,
    
    // Camera & MediaStream
    isCameraRunning: false,
    mediaStream: null,
    hands: null,
    animFrameId: null,
    
    // Performance
    frameCount: 0,
    fps: 0,
    lastFpsTime: Date.now(),
    
    // Devices State (Arduino Pins)
    devices: {
        den: false,      // D8
        cua: false,      // D9 (0° / 90°)
        rem: false,      // D10 (0° / 90°)
        quat: false,     // D11 Relay
        tv: false,       // I2C LCD
        alarm: false     // D7 Buzzer
    },
    
    // Gesture Cooldown (1500ms)
    lastGestureName: null,
    lastGestureTime: 0,
    cooldownDuration: 1500,
    
    // Face Scanning Timer
    isScanningFace: false,
    scanTimer: null
};

// --------------------------------------------------------------------
// 2. DOM ELEMENT REFERENCES
// --------------------------------------------------------------------
const elements = {
    // Top Bar
    btnConnectSerial: document.getElementById('btnConnectSerial'),
    btnSerialText: document.getElementById('btnSerialText'),
    btnToggleCamera: document.getElementById('btnToggleCamera'),
    btnCameraText: document.getElementById('btnCameraText'),
    arduinoBadge: document.getElementById('arduinoBadge'),
    arduinoDot: document.getElementById('arduinoDot'),
    arduinoStatusText: document.getElementById('arduinoStatusText'),
    cameraBadge: document.getElementById('cameraBadge'),
    cameraDot: document.getElementById('cameraDot'),
    cameraStatusText: document.getElementById('cameraStatusText'),
    fpsCounter: document.getElementById('fpsCounter'),
    liveClock: document.getElementById('liveClock'),
    
    // Navigation Tabs
    tabScene1: document.getElementById('tabScene1'),
    tabScene2: document.getElementById('tabScene2'),
    tabScene3: document.getElementById('tabScene3'),
    scene1Container: document.getElementById('scene1Container'),
    scene2Container: document.getElementById('scene2Container'),
    scene3Container: document.getElementById('scene3Container'),
    
    // Scene 1: Face Gate Elements
    webcam1: document.getElementById('webcam1'),
    canvas1: document.getElementById('canvas1'),
    standbyScene1: document.getElementById('standbyScene1'),
    gateStatePill: document.getElementById('gateStatePill'),
    faceTargetBox: document.getElementById('faceTargetBox'),
    faceTargetTag: document.getElementById('faceTargetTag'),
    gateScanningLabel: document.getElementById('gateScanningLabel'),
    gateTimerCounter: document.getElementById('gateTimerCounter'),
    gateProgressFill: document.getElementById('gateProgressFill'),
    btnScanOwner: document.getElementById('btnScanOwner'),
    btnScanGuest: document.getElementById('btnScanGuest'),
    btnQuickToScene2: document.getElementById('btnQuickToScene2'),
    
    // Scene 2: Hand Gesture Elements
    webcam2: document.getElementById('webcam2'),
    canvas2: document.getElementById('canvas2'),
    standbyScene2: document.getElementById('standbyScene2'),
    btnBackToGate: document.getElementById('btnBackToGate'),
    hudGestureBadge: document.getElementById('hudGestureBadge'),
    hudGestureIcon: document.getElementById('hudGestureIcon'),
    hudGestureName: document.getElementById('hudGestureName'),
    hudGestureScore: document.getElementById('hudGestureScore'),
    cooldownBar: document.getElementById('cooldownBar'),
    serialLogs: document.getElementById('serialLogs'),
    btnClearLogs: document.getElementById('btnClearLogs'),
    btnAllOff: document.getElementById('btnAllOff'),
    
    // Devices Cards & Badges
    cardDen: document.getElementById('cardDen'),
    badgeDen: document.getElementById('badgeDen'),
    btnToggleDen: document.getElementById('btnToggleDen'),
    cardCua: document.getElementById('cardCua'),
    badgeCua: document.getElementById('badgeCua'),
    btnOpenCua: document.getElementById('btnOpenCua'),
    btnCloseCua: document.getElementById('btnCloseCua'),
    cardRem: document.getElementById('cardRem'),
    badgeRem: document.getElementById('badgeRem'),
    btnToggleRem: document.getElementById('btnToggleRem'),
    cardQuat: document.getElementById('cardQuat'),
    badgeQuat: document.getElementById('badgeQuat'),
    btnToggleQuat: document.getElementById('btnToggleQuat'),
    cardTv: document.getElementById('cardTv'),
    badgeTv: document.getElementById('badgeTv'),
    btnToggleTv: document.getElementById('btnToggleTv'),
    cardBaoDong: document.getElementById('cardBaoDong'),
    badgeAlarm: document.getElementById('badgeAlarm'),
    btnToggleAlarm: document.getElementById('btnToggleAlarm'),
    
    // Scene 3: Alarm Elements
    btnCancelAlarm: document.getElementById('btnCancelAlarm'),
    btnOverrideOwner: document.getElementById('btnOverrideOwner'),
    
    // Toast
    toastIsland: document.getElementById('toastIsland'),
    toastMessage: document.getElementById('toastMessage')
};

const ctx1 = elements.canvas1.getContext('2d');
const ctx2 = elements.canvas2.getContext('2d');

// --------------------------------------------------------------------
// 3. SOUND SYNTHESIZER (Web Audio API)
// --------------------------------------------------------------------
class SoundFX {
    constructor() {
        this.ctx = null;
        this.alarmInterval = null;
    }
    
    init() {
        if (!this.ctx) {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            this.ctx = new AudioCtx();
        }
        if (this.ctx.state === 'suspended') {
            this.ctx.resume();
        }
    }
    
    tone(freq, duration = 0.08, type = 'sine', gainVal = 0.1) {
        try {
            this.init();
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = type;
            osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
            gain.gain.setValueAtTime(gainVal, this.ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);
            osc.connect(gain);
            gain.connect(this.ctx.destination);
            osc.start();
            osc.stop(this.ctx.currentTime + duration);
        } catch (e) {}
    }
    
    scanBeep() {
        this.tone(1200, 0.04, 'sine', 0.05);
    }
    
    successChime() {
        this.tone(523.25, 0.08); // C5
        setTimeout(() => this.tone(659.25, 0.08), 80); // E5
        setTimeout(() => this.tone(783.99, 0.15), 160); // G5
        setTimeout(() => this.tone(1046.50, 0.25), 260); // C6
    }
    
    startSiren() {
        this.stopSiren();
        let high = false;
        this.alarmInterval = setInterval(() => {
            this.tone(high ? 960 : 640, 0.16, 'sawtooth', 0.15);
            high = !high;
        }, 180);
    }
    
    stopSiren() {
        if (this.alarmInterval) {
            clearInterval(this.alarmInterval);
            this.alarmInterval = null;
        }
    }
}

const sfx = new SoundFX();

// --------------------------------------------------------------------
// 4. REAL-TIME CLOCK & TOAST NOTIFICATION
// --------------------------------------------------------------------
function updateClock() {
    const now = new Date();
    elements.liveClock.textContent = now.toTimeString().split(' ')[0];
}
setInterval(updateClock, 1000);
updateClock();

let toastTimer = null;
function showToast(msg, isAlert = false) {
    if (toastTimer) clearTimeout(toastTimer);
    elements.toastMessage.textContent = msg;
    elements.toastIsland.classList.remove('hidden');
    elements.toastIsland.style.borderColor = isAlert ? 'var(--color-red)' : 'var(--color-cyan)';
    toastTimer = setTimeout(() => {
        elements.toastIsland.classList.add('hidden');
    }, 2800);
}

function appendLog(text, type = 'sys') {
    const entry = document.createElement('div');
    entry.className = `log-entry log-${type}`;
    const timestamp = new Date().toTimeString().split(' ')[0];
    entry.textContent = `[${timestamp}] ${text}`;
    elements.serialLogs.appendChild(entry);
    elements.serialLogs.scrollTop = elements.serialLogs.scrollHeight;
    if (elements.serialLogs.children.length > 90) {
        elements.serialLogs.removeChild(elements.serialLogs.firstChild);
    }
}

elements.btnClearLogs.addEventListener('click', () => {
    elements.serialLogs.innerHTML = '';
    appendLog('Đã làm sạch lịch sử log terminal.', 'sys');
});

// --------------------------------------------------------------------
// 5. 3-SCENE NAVIGATION & WORKFLOW TRANSITIONS
// --------------------------------------------------------------------
function switchScene(sceneNum) {
    state.currentScene = sceneNum;
    
    // Update Tabs
    elements.tabScene1.classList.toggle('is-active', sceneNum === 1);
    elements.tabScene2.classList.toggle('is-active', sceneNum === 2);
    elements.tabScene3.classList.toggle('is-active', sceneNum === 3);
    
    // Toggle Containers
    elements.scene1Container.classList.toggle('hidden', sceneNum !== 1);
    elements.scene2Container.classList.toggle('hidden', sceneNum !== 2);
    elements.scene3Container.classList.toggle('hidden', sceneNum !== 3);
    
    // Emergency theme for Scene 3
    if (sceneNum === 3) {
        document.body.classList.add('theme-emergency');
        sfx.startSiren();
    } else {
        document.body.classList.remove('theme-emergency');
        sfx.stopSiren();
    }
    
    appendLog(`Chuyển sang Giao diện ${sceneNum}.`, 'sys');
}

elements.tabScene1.addEventListener('click', () => switchScene(1));
elements.tabScene2.addEventListener('click', () => switchScene(2));
elements.tabScene3.addEventListener('click', () => switchScene(3));

elements.btnBackToGate.addEventListener('click', () => switchScene(1));
elements.btnQuickToScene2.addEventListener('click', () => switchScene(2));

// --------------------------------------------------------------------
// 6. WEB SERIAL API (UART 9600 BAUD)
// --------------------------------------------------------------------
async function connectSerial() {
    if (!('serial' in navigator)) {
        alert("Trình duyệt này không hỗ trợ Web Serial API!\nVui lòng sử dụng Google Chrome hoặc Microsoft Edge trên máy tính.");
        return;
    }
    
    try {
        if (state.isSerialConnected && state.port) {
            appendLog("Đang đóng cổng Serial...", "sys");
            if (state.reader) { await state.reader.cancel(); state.reader = null; }
            if (state.writer) { await state.writer.close(); state.writer = null; }
            await state.port.close();
            state.port = null;
            updateSerialUI(false);
            appendLog("Đã ngắt kết nối Arduino.", "sys");
            showToast("ĐÃ NGẮT KẾT NỐI ARDUINO");
            return;
        }
        
        appendLog("Đang yêu cầu chọn cổng kết nối USB Arduino...", "sys");
        state.port = await navigator.serial.requestPort();
        await state.port.open({ baudRate: 9600 });
        
        updateSerialUI(true);
        appendLog("ĐÃ KẾT NỐI ARDUINO UNO (9600 BAUD, 8N1).", "rx");
        showToast("ĐÃ KẾT NỐI THÀNH CÔNG ARDUINO UNO!");
        sfx.successChime();
        
        // Start Reading Incoming Data
        readSerialLoop();
        
    } catch (err) {
        console.warn("Serial connection error:", err);
        appendLog(`Lỗi kết nối Serial: ${err.message}`, "err");
        updateSerialUI(false);
    }
}

function updateSerialUI(connected) {
    state.isSerialConnected = connected;
    elements.arduinoDot.className = `dot ${connected ? 'dot-success' : 'dot-danger'}`;
    elements.arduinoStatusText.textContent = connected ? 'ARDUINO: ĐÃ KẾT NỐI (9600)' : 'ARDUINO: CHƯA KẾT NỐI';
    elements.btnSerialText.textContent = connected ? 'NGẮT KẾT NỐI' : 'KẾT NỐI ARDUINO';
    elements.btnConnectSerial.classList.toggle('btn-danger', connected);
    elements.btnConnectSerial.classList.toggle('btn-primary', !connected);
}

async function sendSerialCommand(cmdChar, description) {
    appendLog(`LỆNH GỬI -> '${cmdChar}' (${description})`, "tx");
    
    if (!state.isSerialConnected || !state.port || !state.port.writable) {
        appendLog("Chưa kết nối Arduino qua cổng USB (Mô phỏng lệnh).", "sys");
        return;
    }
    
    try {
        const encoder = new TextEncoder();
        const writer = state.port.writable.getWriter();
        await writer.write(encoder.encode(cmdChar));
        writer.releaseLock();
    } catch (err) {
        console.error("Write serial error:", err);
        appendLog(`Lỗi gửi Serial: ${err.message}`, "err");
    }
}

async function readSerialLoop() {
    while (state.port && state.port.readable && state.isSerialConnected) {
        const textDecoder = new TextDecoderStream();
        const readableStreamClosed = state.port.readable.pipeTo(textDecoder.writable);
        const reader = textDecoder.readable.getReader();
        state.reader = reader;
        
        try {
            while (true) {
                const { value, done } = await reader.read();
                if (done) break;
                if (value) {
                    const lines = value.split('\n');
                    for (const line of lines) {
                        const trimmed = line.trim();
                        if (trimmed) {
                            appendLog(`ARDUINO PHẢN HỒI: ${trimmed}`, "rx");
                            parseArduinoFeedback(trimmed);
                        }
                    }
                }
            }
        } catch (err) {
            console.warn("Serial read loop terminated:", err);
        } finally {
            reader.releaseLock();
        }
    }
}

function parseArduinoFeedback(msg) {
    if (msg.includes('DEN_ON')) syncDeviceUI('den', true);
    else if (msg.includes('CUA_MO_90')) syncDeviceUI('cua', true);
    else if (msg.includes('CUA_DONG_0')) syncDeviceUI('cua', false);
    else if (msg.includes('REM_CUON_LEN')) syncDeviceUI('rem', true);
    else if (msg.includes('REM_THA_XUONG')) syncDeviceUI('rem', false);
    else if (msg.includes('QUAT_ON')) syncDeviceUI('quat', true);
    else if (msg.includes('QUAT_OFF')) syncDeviceUI('quat', false);
    else if (msg.includes('TV_ON')) syncDeviceUI('tv', true);
    else if (msg.includes('TV_OFF')) syncDeviceUI('tv', false);
    else if (msg.includes('CANH_BAO_SOS')) syncDeviceUI('alarm', true);
    else if (msg.includes('TAT_TAT_CA')) {
        syncDeviceUI('den', false);
        syncDeviceUI('cua', false);
        syncDeviceUI('rem', false);
        syncDeviceUI('quat', false);
        syncDeviceUI('tv', false);
        syncDeviceUI('alarm', false);
    }
}

// --------------------------------------------------------------------
// 7. DEVICE UI SYNC & INTERACTIVE CLICK HANDLERS
// --------------------------------------------------------------------
function syncDeviceUI(devKey, isActive) {
    state.devices[devKey] = isActive;
    
    switch (devKey) {
        case 'den':
            elements.cardDen.classList.toggle('is-active', isActive);
            elements.badgeDen.className = `device-badge ${isActive ? 'badge-on' : 'badge-off'}`;
            elements.badgeDen.textContent = isActive ? 'ON' : 'OFF';
            break;
        case 'cua':
            elements.cardCua.classList.toggle('is-active', isActive);
            elements.badgeCua.className = `device-badge ${isActive ? 'badge-on' : 'badge-off'}`;
            elements.badgeCua.textContent = isActive ? 'MỞ (90°)' : 'ĐÓNG (0°)';
            break;
        case 'rem':
            elements.cardRem.classList.toggle('is-active', isActive);
            elements.badgeRem.className = `device-badge ${isActive ? 'badge-on' : 'badge-off'}`;
            elements.badgeRem.textContent = isActive ? 'CUỘN LÊN' : 'HẠ';
            break;
        case 'quat':
            elements.cardQuat.classList.toggle('is-active', isActive);
            elements.badgeQuat.className = `device-badge ${isActive ? 'badge-on' : 'badge-off'}`;
            elements.badgeQuat.textContent = isActive ? 'ON' : 'OFF';
            break;
        case 'tv':
            elements.cardTv.classList.toggle('is-active', isActive);
            elements.badgeTv.className = `device-badge ${isActive ? 'badge-on' : 'badge-off'}`;
            elements.badgeTv.textContent = isActive ? 'ON' : 'OFF';
            break;
        case 'alarm':
            elements.cardBaoDong.classList.toggle('is-active', isActive);
            elements.badgeAlarm.className = `device-badge ${isActive ? 'badge-on' : 'badge-off'}`;
            elements.badgeAlarm.textContent = isActive ? 'HÚ CÒI SOS' : 'BÌNH THƯỜNG';
            break;
    }
}

elements.btnToggleDen.addEventListener('click', () => {
    const next = !state.devices.den;
    syncDeviceUI('den', next);
    sendSerialCommand(next ? 'A' : 'B', next ? "Bật Đèn" : "Tắt Đèn");
    showToast(`ĐÈN: ${next ? 'ĐÃ BẬT' : 'ĐÃ TẮT'}`);
});

elements.btnOpenCua.addEventListener('click', () => {
    syncDeviceUI('cua', true);
    sendSerialCommand('O', "Mở Cửa 90°");
    showToast("CỬA: ĐÃ MỞ (90°)");
});

elements.btnCloseCua.addEventListener('click', () => {
    syncDeviceUI('cua', false);
    sendSerialCommand('C', "Đóng Cửa 0°");
    showToast("CỬA: ĐÃ KHÓA CHẶT (0°)");
});

elements.btnToggleRem.addEventListener('click', () => {
    const next = !state.devices.rem;
    syncDeviceUI('rem', next);
    sendSerialCommand(next ? 'U' : 'B', next ? "Kéo Rèm Lên" : "Hạ Rèm");
    showToast(`RÈM CỬA: ${next ? 'ĐÃ KÉO LÊN' : 'ĐÃ TẮT'}`);
});

elements.btnToggleQuat.addEventListener('click', () => {
    const next = !state.devices.quat;
    syncDeviceUI('quat', next);
    sendSerialCommand('F', "Đảo Trạng Thái Quạt");
    showToast(`QUẠT: ${next ? 'ĐANG CHẠY' : 'ĐÃ TẮT'}`);
});

elements.btnToggleTv.addEventListener('click', () => {
    const next = !state.devices.tv;
    syncDeviceUI('tv', next);
    sendSerialCommand('T', "Bật/Tắt Tivi LCD");
    showToast(`TIVI: ${next ? 'ĐÃ BẬT' : 'ĐÃ TẮT'}`);
});

elements.btnToggleAlarm.addEventListener('click', () => {
    const next = !state.devices.alarm;
    syncDeviceUI('alarm', next);
    sendSerialCommand(next ? 'S' : 'C', next ? "Còi Báo Động SOS" : "Tắt Còi");
    if (next) switchScene(3);
});

elements.btnAllOff.addEventListener('click', () => {
    syncDeviceUI('den', false);
    syncDeviceUI('cua', false);
    syncDeviceUI('rem', false);
    syncDeviceUI('quat', false);
    syncDeviceUI('tv', false);
    syncDeviceUI('alarm', false);
    sendSerialCommand('B', "Nắm Đấm -> Tắt Tất Cả Thiết Bị");
    showToast("ĐÃ TẮT TOÀN BỘ THIẾT BỊ TRONG NHÀ");
});

// Scene 3 Actions
elements.btnCancelAlarm.addEventListener('click', () => {
    syncDeviceUI('alarm', false);
    sendSerialCommand('C', "Tắt Còi & Trở Về Cổng An Ninh");
    showToast("ĐÃ HỦY BÁO ĐỘNG SOS!");
    switchScene(1);
});

elements.btnOverrideOwner.addEventListener('click', () => {
    syncDeviceUI('alarm', false);
    syncDeviceUI('cua', true);
    sendSerialCommand('O', "Xác Minh Chủ Nhà -> Mở Cửa");
    showToast("XÁC NHẬN CHỦ NHÀ HƯNG! ĐÃ MỞ CỬA 90°");
    sfx.successChime();
    switchScene(2);
});

// --------------------------------------------------------------------
// 8. CAMERA LIFECYCLE (DIRECT getUserMedia - NO HANGING)
// --------------------------------------------------------------------
async function startWebcam() {
    try {
        appendLog("Đang yêu cầu quyền truy cập Webcam...", "sys");
        
        // Initialize MediaPipe Hands instance once
        if (!state.hands && typeof Hands !== 'undefined') {
            state.hands = new Hands({
                locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
            });
            state.hands.setOptions({
                maxNumHands: 1,
                modelComplexity: 1,
                minDetectionConfidence: 0.6,
                minTrackingConfidence: 0.6
            });
            state.hands.onResults(onHandResults);
        }
        
        // Native getUserMedia stream
        state.mediaStream = await navigator.mediaDevices.getUserMedia({
            video: {
                width: { ideal: 1280 },
                height: { ideal: 720 },
                facingMode: 'user'
            },
            audio: false
        });
        
        // Attach to both video elements for Scene 1 & Scene 2
        elements.webcam1.srcObject = state.mediaStream;
        elements.webcam2.srcObject = state.mediaStream;
        
        await Promise.all([elements.webcam1.play(), elements.webcam2.play()]);
        
        // Match canvas sizes
        elements.canvas1.width = elements.webcam1.videoWidth || 1280;
        elements.canvas1.height = elements.webcam1.videoHeight || 720;
        elements.canvas2.width = elements.webcam2.videoWidth || 1280;
        elements.canvas2.height = elements.webcam2.videoHeight || 720;
        
        state.isCameraRunning = true;
        elements.standbyScene1.classList.add('hidden');
        elements.standbyScene2.classList.add('hidden');
        
        elements.cameraDot.className = 'dot dot-success';
        elements.cameraStatusText.textContent = 'CAMERA: ĐANG HOẠT ĐỘNG';
        elements.btnCameraText.textContent = 'TẮT CAMERA';
        elements.btnToggleCamera.classList.replace('btn-secondary', 'btn-danger');
        
        appendLog("Webcam đã bật thành công và sẵn sàng xử lý AI.", "rx");
        showToast("CAMERA AI ĐÃ SẴN SÀNG!");
        sfx.tone(880, 0.1);
        
        // Start continuous processing loop
        requestAnimationFrame(renderLoop);
        
    } catch (err) {
        console.error("Camera error:", err);
        alert(`Không thể mở Camera: ${err.message}\nVui lòng cho phép quyền truy cập webcam trên trình duyệt!`);
        appendLog(`Lỗi mở Camera: ${err.message}`, "err");
    }
}

function stopWebcam() {
    state.isCameraRunning = false;
    
    if (state.animFrameId) {
        cancelAnimationFrame(state.animFrameId);
        state.animFrameId = null;
    }
    
    if (state.mediaStream) {
        state.mediaStream.getTracks().forEach(track => track.stop());
        state.mediaStream = null;
    }
    
    elements.webcam1.srcObject = null;
    elements.webcam2.srcObject = null;
    
    elements.standbyScene1.classList.remove('hidden');
    elements.standbyScene2.classList.remove('hidden');
    elements.hudGestureBadge.classList.add('hidden');
    
    elements.cameraDot.className = 'dot dot-danger';
    elements.cameraStatusText.textContent = 'CAMERA: TẮT';
    elements.btnCameraText.textContent = 'BẬT CAMERA AI';
    elements.btnToggleCamera.classList.replace('btn-danger', 'btn-secondary');
    elements.fpsCounter.textContent = '0';
    
    ctx1.clearRect(0, 0, elements.canvas1.width, elements.canvas1.height);
    ctx2.clearRect(0, 0, elements.canvas2.width, elements.canvas2.height);
    
    appendLog("Đã tắt Camera AI.", "sys");
    showToast("ĐÃ TẮT CAMERA");
}

function toggleWebcam() {
    if (state.isCameraRunning) {
        stopWebcam();
    } else {
        startWebcam();
    }
}

elements.btnToggleCamera.addEventListener('click', toggleWebcam);
document.querySelectorAll('.btn-open-cam').forEach(btn => {
    btn.addEventListener('click', startWebcam);
});

// --------------------------------------------------------------------
// 9. CONTINUOUS AI PERCEPTION LOOP (NO FREEZES)
// --------------------------------------------------------------------
let isSendingFrame = false;

async function renderLoop() {
    if (!state.isCameraRunning) return;
    
    // FPS measurement
    state.frameCount++;
    const now = Date.now();
    if (now - state.lastFpsTime >= 1000) {
        state.fps = state.frameCount;
        state.frameCount = 0;
        state.lastFpsTime = now;
        elements.fpsCounter.textContent = state.fps;
    }
    
    if (!isSendingFrame) {
        if (state.currentScene === 2 && state.hands && elements.webcam2.readyState >= 2) {
            isSendingFrame = true;
            try {
                await state.hands.send({ image: elements.webcam2 });
            } catch (e) {
                console.warn("Hands send error:", e);
            } finally {
                isSendingFrame = false;
            }
        }
    }
    
    state.animFrameId = requestAnimationFrame(renderLoop);
}

// --------------------------------------------------------------------
// 10. SCENE 1: BIOMETRIC FACE GATE WORKFLOW
// --------------------------------------------------------------------
function startFaceScan(isOwner) {
    if (!state.isCameraRunning) {
        startWebcam().then(() => runScanSequence(isOwner));
    } else {
        runScanSequence(isOwner);
    }
}

function runScanSequence(isOwner) {
    if (state.isScanningFace) return;
    state.isScanningFace = true;
    
    elements.btnScanOwner.disabled = true;
    elements.btnScanGuest.disabled = true;
    
    elements.faceTargetBox.classList.remove('is-owner', 'is-guest');
    elements.faceTargetBox.classList.add(isOwner ? 'is-owner' : 'is-guest');
    elements.faceTargetTag.textContent = `ĐANG QUÉT: ${isOwner ? 'CHỦ NHÀ HƯNG' : 'NGƯỜI LẠ (KHÁCH)'}`;
    elements.gateStatePill.className = `hud-pill ${isOwner ? 'hud-pill-green' : 'hud-pill-red'}`;
    elements.gateStatePill.textContent = 'ĐANG PHÂN TÍCH KHUÔN MẶT...';
    
    appendLog(`Bắt đầu quy trình quét nhận diện khuôn mặt (${isOwner ? 'Chủ nhà' : 'Khách'})...`, "tx");
    showToast(`ĐANG QUÉT MẶT: ${isOwner ? 'CHỦ NHÀ HƯNG' : 'NGƯỜI LẠ'}...`);
    
    let duration = 5.0; // 5 seconds
    let elapsed = 0;
    const step = 100; // ms
    
    state.scanTimer = setInterval(() => {
        elapsed += (step / 1000);
        const remaining = Math.max(0, duration - elapsed);
        const progress = Math.min(1.0, elapsed / duration);
        
        elements.gateProgressFill.style.width = `${progress * 100}%`;
        elements.gateTimerCounter.textContent = `${remaining.toFixed(1)}s`;
        
        // Scan beeps
        if (Math.round(elapsed * 10) % 5 === 0) {
            sfx.scanBeep();
        }
        
        if (elapsed >= duration) {
            clearInterval(state.scanTimer);
            state.isScanningFace = false;
            elements.btnScanOwner.disabled = false;
            elements.btnScanGuest.disabled = false;
            
            if (isOwner) {
                // SUCCESS: Owner Hung
                elements.gateStatePill.className = 'hud-pill hud-pill-green';
                elements.gateStatePill.textContent = 'XÁC THỰC THÀNH CÔNG: CHỦ NHÀ';
                elements.faceTargetTag.textContent = 'KHỚP 99.2%: CHÀO MỪNG CHỦ NHÀ HƯNG!';
                
                sfx.successChime();
                syncDeviceUI('cua', true);
                sendSerialCommand('O', "Xác Thực Chủ Nhà Hưng Thành Công -> Mở Cửa (90°)");
                showToast("CHÀO MỪNG CHỦ NHÀ HƯNG! ĐÃ MỞ CỬA (90°)");
                appendLog("XÁC THỰC THÀNH CÔNG: Khung xanh chiếm ưu thế -> Cho phép vào nhà.", "rx");
                
                // Transition smoothly to Scene 2 (Hand Gestures) after 1.8s
                setTimeout(() => {
                    switchScene(2);
                    showToast("BÂY GIỜ BẠN CÓ THỂ ĐIỀU KHIỂN CÁC THIẾT BỊ BẰNG CỬ CHỈ TAY!");
                }, 1800);
                
            } else {
                // FAILED: Guest / Intruder
                elements.gateStatePill.className = 'hud-pill hud-pill-red';
                elements.gateStatePill.textContent = 'TỪ CHỐI TRUY CẬP: NGƯỜI LẠ';
                elements.faceTargetTag.textContent = 'CẢNH BÁO: KHUÔN MẶT KHÔNG HỢP LỆ!';
                
                syncDeviceUI('cua', false);
                syncDeviceUI('alarm', true);
                sendSerialCommand('C', "Khóa Cửa 0°");
                sendSerialCommand('S', "Hú Còi Báo Động SOS Chống Trộm");
                showToast("TỪ CHỐI TRUY CẬP: KÍCH HOẠT CÒI BÁO ĐỘNG CHỐNG TRỘM!", true);
                appendLog("CẢNH BÁO: Khung đỏ chiếm ưu thế -> Khóa cửa và hú còi chống trộm.", "err");
                
                // Transition to Scene 3 (Alarm) after 1.5s
                setTimeout(() => {
                    switchScene(3);
                }, 1500);
            }
        }
    }, step);
}

elements.btnScanOwner.addEventListener('click', () => startFaceScan(true));
elements.btnScanGuest.addEventListener('click', () => startFaceScan(false));

// --------------------------------------------------------------------
// 11. SCENE 2: ANATOMICAL HAND GESTURE CLASSIFIER (GOOGLE MEDIAPIPE)
// --------------------------------------------------------------------
function onHandResults(results) {
    ctx2.save();
    ctx2.clearRect(0, 0, elements.canvas2.width, elements.canvas2.height);
    
    if (state.currentScene !== 2) {
        ctx2.restore();
        return;
    }
    
    const now = Date.now();
    
    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
        const landmarks = results.multiHandLandmarks[0];
        
        // 1. Draw 21-point skeleton
        drawHandSkeleton(landmarks);
        
        // 2. Classify Gesture
        const gesture = classifyHandGesture(landmarks);
        
        if (gesture) {
            elements.hudGestureBadge.classList.remove('hidden');
            elements.hudGestureIcon.textContent = gesture.icon;
            elements.hudGestureName.textContent = gesture.title;
            elements.hudGestureScore.textContent = "Khớp: 98%";
            
            // Check Debounce Cooldown
            const elapsed = now - state.lastGestureTime;
            const progress = Math.min(1.0, elapsed / state.cooldownDuration);
            elements.cooldownBar.style.width = `${progress * 100}%`;
            
            if (elapsed >= state.cooldownDuration) {
                state.lastGestureTime = now;
                state.lastGestureName = gesture.name;
                executeGestureAction(gesture);
            }
        } else {
            elements.hudGestureBadge.classList.add('hidden');
        }
    } else {
        elements.hudGestureBadge.classList.add('hidden');
        elements.cooldownBar.style.width = '100%';
    }
    
    ctx2.restore();
}

function drawHandSkeleton(landmarks) {
    const w = elements.canvas2.width;
    const h = elements.canvas2.height;
    
    const connections = [
        [0, 1], [1, 2], [2, 3], [3, 4],
        [0, 5], [5, 6], [6, 7], [7, 8],
        [5, 9], [9, 10], [10, 11], [11, 12],
        [9, 13], [13, 14], [14, 15], [15, 16],
        [13, 17], [17, 18], [18, 19], [19, 20],
        [0, 17]
    ];
    
    ctx2.strokeStyle = '#22d3ee';
    ctx2.lineWidth = 3;
    ctx2.lineCap = 'round';
    
    for (const [i, j] of connections) {
        ctx2.beginPath();
        ctx2.moveTo(landmarks[i].x * w, landmarks[i].y * h);
        ctx2.lineTo(landmarks[j].x * w, landmarks[j].y * h);
        ctx2.stroke();
    }
    
    for (const lm of landmarks) {
        ctx2.beginPath();
        ctx2.arc(lm.x * w, lm.y * h, 5, 0, 2 * Math.PI);
        ctx2.fillStyle = '#06b6d4';
        ctx2.fill();
        ctx2.beginPath();
        ctx2.arc(lm.x * w, lm.y * h, 2, 0, 2 * Math.PI);
        ctx2.fillStyle = '#ffffff';
        ctx2.fill();
    }
}

function classifyHandGesture(lm) {
    const p0 = lm[0];
    const p9 = lm[9];
    const palm = Math.hypot(p9.x - p0.x, p9.y - p0.y);
    
    const isIndexExtended = Math.hypot(lm[8].x - p0.x, lm[8].y - p0.y) > Math.hypot(lm[6].x - p0.x, lm[6].y - p0.y) * 1.15;
    const isMiddleExtended = Math.hypot(lm[12].x - p0.x, lm[12].y - p0.y) > Math.hypot(lm[10].x - p0.x, lm[10].y - p0.y) * 1.15;
    const isRingExtended = Math.hypot(lm[16].x - p0.x, lm[16].y - p0.y) > Math.hypot(lm[14].x - p0.x, lm[14].y - p0.y) * 1.15;
    const isPinkyExtended = Math.hypot(lm[20].x - p0.x, lm[20].y - p0.y) > Math.hypot(lm[18].x - p0.x, lm[18].y - p0.y) * 1.15;
    const isThumbExtended = Math.hypot(lm[4].x - lm[9].x, lm[4].y - lm[9].y) > palm * 0.75;
    
    const count = (isIndexExtended ? 1 : 0) + (isMiddleExtended ? 1 : 0) + (isRingExtended ? 1 : 0) + (isPinkyExtended ? 1 : 0);
    
    // 1. Closed Fist (Nắm đấm -> Tắt tất cả)
    if (count === 0 && !isThumbExtended) {
        return { name: 'Closed_Fist', title: 'Nắm đấm (Tắt tất cả)', icon: '✊' };
    }
    
    // 2. OK Sign (Ngón trỏ chạm ngón cái + 3 ngón kia duỗi)
    const thumbIndexDist = Math.hypot(lm[4].x - lm[8].x, lm[4].y - lm[8].y);
    if (thumbIndexDist < palm * 0.35 && isMiddleExtended && isRingExtended) {
        return { name: 'OK_SIGN', title: 'Dấu OK (Bật/Tắt Tivi)', icon: '👌' };
    }
    
    // 3. 1 Finger (Pointing Up -> Bật/Tắt Đèn)
    if (isIndexExtended && !isMiddleExtended && !isRingExtended && !isPinkyExtended) {
        return { name: 'Pointing_Up', title: '1 Ngón trỏ (Bật Đèn)', icon: '👉' };
    }
    
    // 4. 2 Fingers (Victory -> Mở/Đóng Cửa)
    if (isIndexExtended && isMiddleExtended && !isRingExtended && !isPinkyExtended) {
        return { name: 'Victory', title: '2 Ngón chữ V (Mở Cửa)', icon: '✌️' };
    }
    
    // 5. 3 Fingers (Kéo Rèm Lên)
    if (isIndexExtended && isMiddleExtended && isRingExtended && !isPinkyExtended) {
        return { name: 'Three_Fingers', title: '3 Ngón tay (Kéo Rèm Lên)', icon: '🤟' };
    }
    
    // 6. Open Palm (Xòe 5 ngón -> Quạt)
    if (count >= 4 && isThumbExtended) {
        return { name: 'Open_Palm', title: 'Xòe 5 ngón (Đảo Quạt)', icon: '🖐️' };
    }
    
    return null;
}

function executeGestureAction(gesture) {
    sfx.tone(700, 0.08);
    
    switch (gesture.name) {
        case 'Pointing_Up':
            const nextDen = !state.devices.den;
            syncDeviceUI('den', nextDen);
            sendSerialCommand(nextDen ? 'A' : 'B', `1 Ngón trỏ -> ${nextDen ? 'Bật Đèn' : 'Tắt Đèn'}`);
            showToast(`CỬ CHỈ: ${nextDen ? 'ĐÃ BẬT ĐÈN CHIẾU SÁNG' : 'ĐÃ TẮT ĐÈN'}`);
            break;
            
        case 'Victory':
            const nextCua = !state.devices.cua;
            syncDeviceUI('cua', nextCua);
            sendSerialCommand(nextCua ? 'O' : 'C', `2 Ngón Chữ V -> ${nextCua ? 'Mở Cửa 90°' : 'Đóng Cửa 0°'}`);
            showToast(`CỬ CHỈ: ${nextCua ? 'ĐÃ MỞ CỬA (90°)' : 'ĐÃ ĐÓNG CỬA (0°)'}`);
            break;
            
        case 'Three_Fingers':
            const nextRem = !state.devices.rem;
            syncDeviceUI('rem', nextRem);
            sendSerialCommand(nextRem ? 'U' : 'B', `3 Ngón -> ${nextRem ? 'Kéo Rèm Lên (90°)' : 'Hạ Rèm'}`);
            showToast(`CỬ CHỈ: ${nextRem ? 'ĐÃ KÉO RÈM CỬA LÊN' : 'ĐÃ HẠ RÈM'}`);
            break;
            
        case 'Open_Palm':
            const nextQuat = !state.devices.quat;
            syncDeviceUI('quat', nextQuat);
            sendSerialCommand('F', "Xòe 5 Ngón -> Đảo Quạt");
            showToast(`CỬ CHỈ: ${nextQuat ? 'ĐÃ BẬT QUẠT' : 'ĐÃ TẮT QUẠT'}`);
            break;
            
        case 'OK_SIGN':
            const nextTv = !state.devices.tv;
            syncDeviceUI('tv', nextTv);
            sendSerialCommand('T', "Dấu OK -> Đảo Tivi");
            showToast(`CỬ CHỈ: ${nextTv ? 'ĐÃ BẬT TIVI LCD' : 'ĐÃ TẮT TIVI'}`);
            break;
            
        case 'Closed_Fist':
            syncDeviceUI('den', false);
            syncDeviceUI('cua', false);
            syncDeviceUI('rem', false);
            syncDeviceUI('quat', false);
            syncDeviceUI('tv', false);
            syncDeviceUI('alarm', false);
            sendSerialCommand('B', "Nắm Đấm -> Tắt Toàn Bộ Thiết Bị");
            showToast("CỬ CHỈ NẮM ĐẤM: ĐÃ TẮT TOÀN BỘ THIẾT BỊ");
            break;
    }
}

appendLog("Khởi tạo xong bộ điều khiển Smart Home 3 giao diện.", "sys");
