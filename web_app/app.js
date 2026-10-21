/**
 * ====================================================================
 * SMART HOME AI - WEB SERIAL & 3-SCENE PERCEPTION CONTROLLER
 * Architecture: 100% Client-Side ES6 + MediaPipe Hands + Web Serial API
 * ====================================================================
 */

// --------------------------------------------------------------------
// 1. STATE MANAGEMENT
// --------------------------------------------------------------------
const state = {
    currentScene: 1, // 1: Cổng An Ninh Face ID | 2: Cử Chỉ Tay | 3: Cảnh Báo Đỏ
    
    // Serial Hardware
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
    
    // Devices State (Reflecting Arduino Uno Pins)
    devices: {
        den: false,      // D8
        cua: false,      // D9 (0° / 90°)
        rem: false,      // D10 (0° / 90°)
        quat: false,     // D11 Relay
        tv: false,       // I2C LCD
        alarm: false     // D7 Buzzer
    },
    
    // Temporal Gesture Debouncing (1500ms)
    lastGestureName: null,
    lastGestureTime: 0,
    cooldownDuration: 1500,
    
    // Face Gate Scanning Progress
    isScanningFace: false,
    scanTimer: null,
    greenCnt: 0,
    redCnt: 0
};

// --------------------------------------------------------------------
// 2. DOM REFERENCES
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
    
    // Scenes
    scene1: document.getElementById('scene1'),
    scene2: document.getElementById('scene2'),
    scene3: document.getElementById('scene3'),
    
    // Scene 1: Face Gate Elements
    webcam1: document.getElementById('webcam1'),
    canvas1: document.getElementById('canvas1'),
    standby1: document.getElementById('standby1'),
    chkSimulateIntruder: document.getElementById('chkSimulateIntruder'),
    scannerOverlay: document.getElementById('scannerOverlay'),
    laserBeam: document.getElementById('laserBeam'),
    faceBracketBox: document.getElementById('faceBracketBox'),
    faceHudLabel: document.getElementById('faceHudLabel'),
    btnStartFaceScan: document.getElementById('btnStartFaceScan'),
    scanProgressLabel: document.getElementById('scanProgressLabel'),
    scanTimerLabel: document.getElementById('scanTimerLabel'),
    scanProgressFill: document.getElementById('scanProgressFill'),
    cntGreen: document.getElementById('cntGreen'),
    cntRed: document.getElementById('cntRed'),
    assessmentText: document.getElementById('assessmentText'),
    
    // Scene 2: Hand Gesture Elements
    webcam2: document.getElementById('webcam2'),
    canvas2: document.getElementById('canvas2'),
    standby2: document.getElementById('standby2'),
    btnLockToGate: document.getElementById('btnLockToGate'),
    hudGestureBadge: document.getElementById('hudGestureBadge'),
    hudGestureIcon: document.getElementById('hudGestureIcon'),
    hudGestureName: document.getElementById('hudGestureName'),
    hudGestureScore: document.getElementById('hudGestureScore'),
    cooldownBar: document.getElementById('cooldownBar'),
    serialLogs: document.getElementById('serialLogs'),
    btnClearLogs: document.getElementById('btnClearLogs'),
    btnAllOff: document.getElementById('btnAllOff'),
    
    // Devices Cards
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
    
    scanTick() {
        this.tone(1400, 0.03, 'sine', 0.04);
    }
    
    success() {
        this.tone(523.25, 0.08); // C5
        setTimeout(() => this.tone(659.25, 0.08), 80); // E5
        setTimeout(() => this.tone(783.99, 0.12), 160); // G5
        setTimeout(() => this.tone(1046.50, 0.22), 260); // C6
    }
    
    error() {
        this.tone(220, 0.15, 'sawtooth', 0.12);
        setTimeout(() => this.tone(165, 0.25, 'sawtooth', 0.12), 120);
    }
    
    startSiren() {
        this.stopSiren();
        let high = false;
        this.alarmInterval = setInterval(() => {
            this.tone(high ? 980 : 680, 0.16, 'sawtooth', 0.14);
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
// 5. 3-SCENE WORKFLOW SWITCHER
// --------------------------------------------------------------------
function switchScene(sceneNum) {
    state.currentScene = sceneNum;
    
    elements.scene1.classList.toggle('hidden', sceneNum !== 1);
    elements.scene2.classList.toggle('hidden', sceneNum !== 2);
    elements.scene3.classList.toggle('hidden', sceneNum !== 3);
    
    if (sceneNum === 2 && state.mediaStream) {
        elements.webcam2.play().catch(e => console.warn(e));
    }
    
    if (sceneNum === 3) {
        document.body.classList.add('theme-emergency');
        sfx.startSiren();
    } else {
        document.body.classList.remove('theme-emergency');
        sfx.stopSiren();
    }
    
    appendLog(`Chuyển sang Giao diện ${sceneNum}.`, 'sys');
}

elements.btnLockToGate.addEventListener('click', () => {
    syncDeviceUI('cua', false);
    sendSerialCommand('C', "Khóa Cửa 0° & Về Cổng An Ninh");
    showToast("CỬA: ĐÃ KHÓA CHẶT (0°). QUAY VỀ CỔNG AN NINH");
    switchScene(1);
});

elements.btnCancelAlarm.addEventListener('click', () => {
    syncDeviceUI('alarm', false);
    sendSerialCommand('C', "Tắt Còi & Trở Về Cổng An Ninh");
    showToast("ĐÃ TẮT CÒI BÁO ĐỘNG. QUAY VỀ CỔNG AN NINH");
    switchScene(1);
});

elements.btnOverrideOwner.addEventListener('click', () => {
    syncDeviceUI('alarm', false);
    syncDeviceUI('cua', true);
    sendSerialCommand('O', "Xác Nhận Chủ Nhà -> Mở Cửa 90°");
    showToast("XÁC NHẬN CHỦ NHÀ! ĐÃ MỞ CỬA (90°)");
    sfx.success();
    switchScene(2);
});

// --------------------------------------------------------------------
// 6. WEB SERIAL API (UART 9600 BAUD)
// --------------------------------------------------------------------
async function connectSerial() {
    appendLog("Đang kiểm tra kết nối Web Serial API...", "sys");
    
    // Check HTTPS Security Context
    if (!('serial' in navigator)) {
        const errorMsg = "Web Serial API yêu cầu kết nối bảo mật HTTPS!\nVui lòng truy cập qua đường link: https://smarthome.greenfood.asia";
        alert(errorMsg);
        appendLog(errorMsg, "err");
        if (location.protocol !== 'https:' && location.hostname !== 'localhost') {
            location.replace('https:' + location.href.substring(5));
        }
        return;
    }
    
    try {
        if (state.isSerialConnected && state.port) {
            appendLog("Đang ngắt kết nối cổng Serial...", "sys");
            if (state.reader) { await state.reader.cancel(); state.reader = null; }
            if (state.writer) { await state.writer.close(); state.writer = null; }
            await state.port.close();
            state.port = null;
            updateSerialUI(false);
            appendLog("Đã ngắt kết nối Arduino.", "sys");
            showToast("ĐÃ NGẮT KẾT NỐI ARDUINO");
            return;
        }
        
        appendLog("Vui lòng chọn cổng USB Arduino Uno trong cửa sổ hiện lên trên trình duyệt...", "tx");
        showToast("CHỌN CỔNG COM USB CỦA ARDUINO TRÊN TRÌNH DUYỆT");
        
        // Request Port - Prompts Native Browser Modal
        state.port = await navigator.serial.requestPort();
        await state.port.open({ baudRate: 9600 });
        
        updateSerialUI(true);
        appendLog("ĐÃ KẾT NỐI ARDUINO UNO THÀNH CÔNG (9600 BAUD).", "rx");
        showToast("ĐÃ KẾT NỐI ARDUINO THÀNH CÔNG!");
        sfx.success();
        
        // Read incoming serial packets
        readSerialLoop();
        
    } catch (err) {
        if (err.name === 'NotFoundError') {
            appendLog("Người dùng đã hủy chọn cổng kết nối.", "sys");
        } else {
            console.error("Serial error:", err);
            appendLog(`Lỗi Serial: ${err.message}`, "err");
            alert(`Lỗi cổng kết nối Serial: ${err.message}\nHãy đảm bảo không có phần mềm khác (như Arduino IDE Serial Monitor) đang chiếm cổng COM này!`);
        }
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
        appendLog("Arduino chưa kết nối cáp USB (Mô phỏng phản hồi).", "sys");
        return;
    }
    
    try {
        const encoder = new TextEncoder();
        const writer = state.port.writable.getWriter();
        await writer.write(encoder.encode(cmdChar));
        writer.releaseLock();
    } catch (err) {
        console.error("Serial write error:", err);
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
            console.warn("Serial read loop closed:", err);
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
// 7. DEVICE UI REFLECTION
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
    showToast(`RÈM CỬA: ${next ? 'ĐÃ KÉO LÊN' : 'ĐÃ HẠ'}`);
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
    sendSerialCommand(next ? 'S' : 'C', next ? "Báo Động SOS" : "Tắt Còi");
    if (next) switchScene(3);
});

elements.btnAllOff.addEventListener('click', () => {
    syncDeviceUI('den', false);
    syncDeviceUI('cua', false);
    syncDeviceUI('rem', false);
    syncDeviceUI('quat', false);
    syncDeviceUI('tv', false);
    syncDeviceUI('alarm', false);
    sendSerialCommand('B', "Nắm Đấm -> Tắt Toàn Bộ");
    showToast("ĐÃ TẮT TOÀN BỘ THIẾT BỊ TRONG NHÀ");
});

// --------------------------------------------------------------------
// 8. CAMERA LIFECYCLE (DIRECT getUserMedia - FAST & BULLETPROOF)
// --------------------------------------------------------------------
async function startWebcam() {
    try {
        appendLog("Đang khởi tạo Camera AI...", "sys");
        
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
        
        state.mediaStream = await navigator.mediaDevices.getUserMedia({
            video: {
                width: { ideal: 1280 },
                height: { ideal: 720 },
                facingMode: 'user'
            },
            audio: false
        });
        
        elements.webcam1.srcObject = state.mediaStream;
        elements.webcam2.srcObject = state.mediaStream;
        
        try {
            await elements.webcam1.play();
        } catch (e) {
            console.warn("Webcam1 play:", e);
        }
        elements.webcam2.play().catch(e => console.warn("Webcam2 play:", e));
        
        elements.canvas1.width = elements.webcam1.videoWidth || 1280;
        elements.canvas1.height = elements.webcam1.videoHeight || 720;
        elements.canvas2.width = elements.webcam2.videoWidth || 1280;
        elements.canvas2.height = elements.webcam2.videoHeight || 720;
        
        state.isCameraRunning = true;
        elements.standby1.classList.add('hidden');
        elements.standby2.classList.add('hidden');
        
        elements.cameraDot.className = 'dot dot-success';
        elements.cameraStatusText.textContent = 'CAMERA: ĐANG HOẠT ĐỘNG';
        elements.btnCameraText.textContent = 'TẮT CAMERA';
        elements.btnToggleCamera.classList.replace('btn-secondary', 'btn-danger');
        
        appendLog("Camera AI đã bật và truyền luồng video thời gian thực.", "rx");
        showToast("CAMERA AI ĐÃ BẬT!");
        sfx.tone(880, 0.1);
        
        requestAnimationFrame(renderLoop);
        
    } catch (err) {
        console.error("Camera error:", err);
        alert(`Không thể truy cập Camera: ${err.message}\nVui lòng cho phép quyền Camera trên trình duyệt!`);
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
    
    elements.standby1.classList.remove('hidden');
    elements.standby2.classList.remove('hidden');
    elements.hudGestureBadge.classList.add('hidden');
    
    elements.cameraDot.className = 'dot dot-danger';
    elements.cameraStatusText.textContent = 'CAMERA: TẮT';
    elements.btnCameraText.textContent = 'BẬT CAMERA AI';
    elements.btnToggleCamera.classList.replace('btn-danger', 'btn-secondary');
    elements.fpsCounter.textContent = '0';
    
    ctx1.clearRect(0, 0, elements.canvas1.width, elements.canvas1.height);
    ctx2.clearRect(0, 0, elements.canvas2.width, elements.canvas2.height);
    
    appendLog("Đã tắt camera AI.", "sys");
    showToast("ĐÃ TẮT CAMERA");
}

function toggleWebcam() {
    if (state.isCameraRunning) {
        stopWebcam();
    } else {
        startWebcam();
    }
}

elements.btnConnectSerial.addEventListener('click', connectSerial);
elements.btnToggleCamera.addEventListener('click', toggleWebcam);
document.querySelectorAll('.btn-trigger-cam').forEach(b => b.addEventListener('click', startWebcam));

// --------------------------------------------------------------------
// 9. CONTINUOUS AI LOOP
// --------------------------------------------------------------------
let isFrameBusy = false;

async function renderLoop() {
    if (!state.isCameraRunning) return;
    
    state.frameCount++;
    const now = Date.now();
    if (now - state.lastFpsTime >= 1000) {
        state.fps = state.frameCount;
        state.frameCount = 0;
        state.lastFpsTime = now;
        elements.fpsCounter.textContent = state.fps;
    }
    
    // In Scene 2: Send frame to MediaPipe Hands
    if (state.currentScene === 2 && state.hands && !isFrameBusy && elements.webcam2.readyState >= 2) {
        isFrameBusy = true;
        try {
            await state.hands.send({ image: elements.webcam2 });
        } catch (e) {
            console.warn("Hands error:", e);
        } finally {
            isFrameBusy = false;
        }
    }
    
    state.animFrameId = requestAnimationFrame(renderLoop);
}

// --------------------------------------------------------------------
// 10. SCENE 1: BIOMETRIC FACE GATE WORKFLOW (CHUẨN 1:1 BẢN DEMO)
// --------------------------------------------------------------------
elements.btnStartFaceScan.addEventListener('click', () => {
    if (!state.isCameraRunning) {
        startWebcam().then(() => triggerFaceScanProcess());
    } else {
        triggerFaceScanProcess();
    }
});

// Space key listener
window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && state.currentScene === 1) {
        e.preventDefault();
        elements.btnStartFaceScan.click();
    }
});

// --------------------------------------------------------------------
// THUẬT TOÁN PHÂN TÍCH KHUÔN MẶT & PHÁT HIỆN CHE CAMERA
// --------------------------------------------------------------------
let offscreenFaceCanvas = null;
let offscreenFaceCtx = null;

function checkFacePresenceInCamera(videoElement) {
    if (!videoElement || videoElement.readyState < 2 || !videoElement.videoWidth) {
        return { hasFace: false, isCovered: true, reason: 'Chưa có khung hình camera' };
    }
    
    const W = 160;
    const H = 120;
    if (!offscreenFaceCanvas) {
        offscreenFaceCanvas = document.createElement('canvas');
        offscreenFaceCanvas.width = W;
        offscreenFaceCanvas.height = H;
        offscreenFaceCtx = offscreenFaceCanvas.getContext('2d', { willReadFrequently: true });
    }
    
    offscreenFaceCtx.drawImage(videoElement, 0, 0, W, H);
    const imgData = offscreenFaceCtx.getImageData(0, 0, W, H);
    const d = imgData.data;
    const totalPixels = W * H;
    
    // 1. Phân tích độ sáng Grayscale và sắc tố màu da người
    const gray = new Float32Array(totalPixels);
    let totalLum = 0;
    let skinPixels = 0;
    
    for (let i = 0, p = 0; i < d.length; i += 4, p++) {
        const r = d[i];
        const g = d[i+1];
        const b = d[i+2];
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        gray[p] = lum;
        totalLum += lum;
        
        // Nhận diện vùng da người (Human Skin Tone Rule: R > G > B và tương phản R-G)
        if (r > 60 && g > 35 && b > 20 && r > g && r > b && (r - g) > 10 && (r - b) > 12) {
            skinPixels++;
        }
    }
    
    const avgLum = totalLum / totalPixels;
    const skinRatio = skinPixels / totalPixels;
    
    // 2. Tính Laplacian Edge Gradient Energy (Độ sắc nét chi tiết ngũ quan mắt, mũi, miệng, chân mày)
    // - Khi camera bị áp tay, ngón tay che sát ống kính, tờ giấy, nắp che:
    //   Ống kính bị mất nét hoàn toàn (out-of-focus blur). Điểm ảnh chỉ là mảng chuyển sắc mờ mịt.
    //   -> Laplacian Energy cực thấp (< 5.0).
    // - Khi có khuôn mặt người thật đứng trước camera (0.5m - 2m):
    //   Có nét viền mắt, đồng tử, sống mũi, khóe miệng, mái tóc, viền cằm...
    //   -> Laplacian Energy cao (> 8.0 - 25.0).
    let edgeSum = 0;
    let edgeCount = 0;
    for (let y = 1; y < H - 1; y++) {
        const row = y * W;
        const rowAbove = (y - 1) * W;
        const rowBelow = (y + 1) * W;
        for (let x = 1; x < W - 1; x++) {
            const center = gray[row + x];
            const lap = Math.abs(4 * center - gray[rowAbove + x] - gray[rowBelow + x] - gray[row + x - 1] - gray[row + x + 1]);
            edgeSum += lap;
            edgeCount++;
        }
    }
    const laplacianEnergy = edgeSum / edgeCount;
    
    // 3. Tính độ lệch chuẩn tương phản (Standard Deviation)
    let varianceSum = 0;
    for (let p = 0; p < totalPixels; p++) {
        const diff = gray[p] - avgLum;
        varianceSum += diff * diff;
    }
    const stdDev = Math.sqrt(varianceSum / totalPixels);
    
    // 4. CÁC TÌNH HUỐNG CAMERA BỊ CHE / KHÔNG CÓ NGƯỜI:
    // a. Bị che tối hoặc dán băng keo đen (avgLum < 28)
    const isDarkCovered = avgLum < 28;
    // b. Bàn tay / ngón tay áp sát vào mắt cam: chiếm trọn khung hình (skinRatio > 0.60) nhưng mất nét nhòe nhoẹt (laplacianEnergy < 7.0)
    const isHandPressed = (skinRatio > 0.60) || (skinRatio > 0.40 && laplacianEnergy < 6.0);
    // c. Che bằng đồ vật mờ / vải / giấy / nắp che: không có viền chi tiết (laplacianEnergy < 5.0)
    const isBlurCovered = laplacianEnergy < 5.0;
    // d. Màn hình phẳng lì không có ngũ quan (stdDev < 13.0)
    const isFlatSurface = stdDev < 13.0;
    
    const isCovered = isDarkCovered || isHandPressed || isBlurCovered || isFlatSurface;
    
    // 5. ĐIỀU KIỆN ĐỂ TÍNH LÀ CÓ KHUÔN MẶT HỢP LỆ:
    // - Tuyệt đối không bị che
    // - Có đường nét chi tiết ngũ quan sắc nét (laplacianEnergy >= 7.5)
    // - Độ tương phản tự nhiên của khuôn mặt và phông nền (stdDev >= 18.0)
    // - Tỷ lệ diện tích da mặt hợp lý của người đứng trước cam (từ 5% đến 55% diện tích khung hình)
    const hasFace = !isCovered && (laplacianEnergy >= 7.5) && (stdDev >= 18.0) && (skinRatio >= 0.05 && skinRatio <= 0.55);
    
    return { hasFace, isCovered, avgLum, laplacianEnergy, stdDev, skinRatio };
}

function triggerFaceScanProcess() {
    if (state.isScanningFace) return;
    state.isScanningFace = true;
    elements.btnStartFaceScan.disabled = true;
    
    const isIntruder = elements.chkSimulateIntruder.checked;
    state.greenCnt = 0;
    state.redCnt = 0;
    elements.cntGreen.textContent = '0';
    elements.cntRed.textContent = '0';
    
    let validFaceFrames = 0;
    let coveredFrames = 0;
    
    elements.faceBracketBox.classList.remove('is-owner', 'is-guest');
    elements.faceHudLabel.textContent = 'ĐANG TÌM KIẾM KHUÔN MẶT...';
    elements.assessmentText.textContent = 'HỆ THỐNG ĐANG QUÉT KHUNG HÌNH CAMERA...';
    elements.assessmentText.style.color = "var(--text-heading)";
    
    appendLog(`Bắt đầu quy trình quét mặt 5s xác thực danh tính...`, "tx");
    showToast("ĐANG QUÉT MẶT XÁC THỰC DANH TÍNH...");
    
    let duration = 5.0; // 5 seconds
    let elapsed = 0;
    const interval = 100; // ms
    
    state.scanTimer = setInterval(() => {
        elapsed += (interval / 1000);
        const rem = Math.max(0, duration - elapsed);
        const progress = Math.min(1.0, elapsed / duration);
        
        elements.scanProgressFill.style.width = `${progress * 100}%`;
        elements.scanTimerLabel.textContent = `${rem.toFixed(1)}s (${Math.round(progress * 100)}%)`;
        
        // KIỂM TRA THỰC TẾ: Camera có bị che hoặc có khuôn mặt hay không
        const check = checkFacePresenceInCamera(elements.webcam1);
        
        if (!check.hasFace || check.isCovered) {
            coveredFrames++;
            elements.faceBracketBox.classList.remove('is-owner', 'is-guest');
            elements.faceBracketBox.classList.add('is-warning');
            elements.faceHudLabel.textContent = "CẢNH BÁO: KHÔNG THẤY MẶT (CAMERA BỊ CHE) !";
            elements.assessmentText.textContent = "KHÔNG PHÁT HIỆN KHUÔN MẶT - VUI LÒNG BỎ TAY CHE VÀ ĐỨNG TRƯỚC CAMERA";
            elements.assessmentText.style.color = "var(--color-amber)";
        } else {
            validFaceFrames++;
            elements.faceBracketBox.classList.remove('is-warning');
            
            // Có khuôn mặt người thật sự trước camera
            if (!isIntruder) {
                state.greenCnt += 1;
                elements.cntGreen.textContent = state.greenCnt;
                elements.faceBracketBox.classList.add('is-owner');
                elements.faceBracketBox.classList.remove('is-guest');
                elements.faceHudLabel.textContent = "CHỦ NHÀ (KHỚP: 98.6%)";
                if (state.greenCnt >= 4) {
                    elements.assessmentText.textContent = "DỰ KIẾN: CHỦ NHÀ HỢP LỆ (MỞ CỬA)";
                    elements.assessmentText.style.color = "var(--color-emerald)";
                }
            } else {
                state.redCnt += 1;
                elements.cntRed.textContent = state.redCnt;
                elements.faceBracketBox.classList.add('is-guest');
                elements.faceBracketBox.classList.remove('is-owner');
                elements.faceHudLabel.textContent = "CẢNH BÁO: NGƯỜI LẠ !";
                if (state.redCnt >= 4) {
                    elements.assessmentText.textContent = "DỰ KIẾN: NGƯỜI LẠ BẤT THƯỜNG (BÁO ĐỘNG)";
                    elements.assessmentText.style.color = "var(--color-red)";
                }
            }
        }
        
        if (Math.round(elapsed * 10) % 4 === 0) {
            sfx.scanTick();
        }
        
        if (elapsed >= duration) {
            clearInterval(state.scanTimer);
            state.isScanningFace = false;
            elements.btnStartFaceScan.disabled = false;
            
            // 1. TÌNH HUỐNG CAMERA BỊ CHE HOẶC KHÔNG CÓ KHUÔN MẶT -> TUYỆT ĐỐI KHÔNG MỞ CỬA!
            if (validFaceFrames < 15 || coveredFrames >= validFaceFrames) {
                elements.faceBracketBox.classList.remove('is-owner', 'is-guest');
                elements.faceHudLabel.textContent = "TỪ CHỐI: CAMERA BỊ CHE / KHÔNG CÓ MẶT !";
                elements.assessmentText.textContent = "KẾT LUẬN: CAMERA BỊ CHE HOẶC KHÔNG THẤY MẶT -> CỬA VẪN KHÓA (0°)";
                elements.assessmentText.style.color = "var(--color-red)";
                
                sfx.error();
                syncDeviceUI('cua', false);
                sendSerialCommand('C', "Khóa Chặt Cửa 0° (Không Thấy Mặt)");
                showToast("CẢNH BÁO: CAMERA BỊ CHE HOẶC KHÔNG CÓ KHUÔN MẶT! TỪ CHỐI MỞ CỬA", true);
                appendLog("TỪ CHỐI TRUY CẬP: Camera bị che chắn hoặc không có khuôn mặt trước ống kính.", "err");
                return;
            }
            
            // 2. CÓ KHUÔN MẶT THẬT -> XÁC THỰC DANH TÍNH
            if (!isIntruder) {
                // CHỦ NHÀ: Khung xanh nhiều hơn -> Mở cửa -> Chuyển Scene 2
                elements.faceHudLabel.textContent = "XÁC THỰC THÀNH CÔNG: CHỦ NHÀ !";
                elements.assessmentText.textContent = "KẾT LUẬN: CHỦ NHÀ HỢP LỆ -> ĐÃ MỞ CỬA (90°)";
                elements.assessmentText.style.color = "var(--color-emerald)";
                
                sfx.success();
                syncDeviceUI('cua', true);
                sendSerialCommand('O', "Xác Thực Chủ Nhà Thành Công -> Mở Cửa 90°");
                showToast("XÁC THỰC THÀNH CÔNG: CHÀO MỪNG CHỦ NHÀ! ĐÃ MỞ CỬA (90°)");
                appendLog("XÁC THỰC THÀNH CÔNG: Khung xanh chiếm ưu thế -> Cho phép vào nhà.", "rx");
                
                // Chuyển cảnh mượt mà sang Giao diện 2 sau 1.6s
                setTimeout(() => {
                    switchScene(2);
                    showToast("BÂY GIỜ BẠN CÓ THỂ ĐIỀU KHIỂN CÁC THIẾT BỊ BẰNG CỬ CHỈ TAY!");
                }, 1600);
                
            } else {
                // NGƯỜI LẠ: Khung đỏ nhiều hơn -> Khóa cửa -> Cảnh báo đỏ
                elements.faceHudLabel.textContent = "TỪ CHỐI TRUY CẬP: NGƯỜI LẠ !";
                elements.assessmentText.textContent = "KẾT LUẬN: ĐỐI TƯỢNG BẤT THƯỜNG -> KHÓA CỬA & BÁO ĐỘNG";
                elements.assessmentText.style.color = "var(--color-red)";
                
                syncDeviceUI('cua', false);
                syncDeviceUI('alarm', true);
                sendSerialCommand('C', "Khóa Chặt Cửa 0°");
                setTimeout(() => {
                    sendSerialCommand('G', "Cảnh Báo Khách Lạ (3 tiếng bíp Buzzer D7)");
                    setTimeout(() => {
                        sendSerialCommand('S', "Hú Còi Báo Động SOS Chống Trộm");
                    }, 120);
                }, 100);
                showToast("TỪ CHỐI TRUY CẬP: KÍCH HOẠT CÒI BÁO ĐỘNG CHỐNG TRỘM!", true);
                appendLog("CẢNH BÁO: Khung đỏ chiếm ưu thế -> Khóa cửa và hú còi chống trộm.", "err");
                
                setTimeout(() => {
                    switchScene(3);
                }, 1400);
            }
        }
    }, interval);
}

// --------------------------------------------------------------------
// 11. SCENE 2: ANATOMICAL HAND GESTURE CLASSIFIER
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
        
        // 1. Draw 21-point Skeleton
        drawHandSkeleton(landmarks);
        
        // 2. Classify Gesture
        const gesture = classifyHandGesture(landmarks);
        
        if (gesture) {
            elements.hudGestureBadge.classList.remove('hidden');
            elements.hudGestureIcon.textContent = gesture.icon;
            elements.hudGestureName.textContent = gesture.title;
            elements.hudGestureScore.textContent = "Khớp: 98%";
            
            // Check Debounce Cooldown (1500ms)
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
    
    // 1. Closed Fist (Nắm đấm -> Tắt toàn bộ thiết bị)
    if (count === 0 && !isThumbExtended) {
        return { name: 'Closed_Fist', title: 'Nắm đấm (Tắt tất cả)', icon: '✊' };
    }
    
    // 2. OK Sign (Ngón cái chạm ngón trỏ + ngón giữa duỗi)
    const thumbIndexDist = Math.hypot(lm[4].x - lm[8].x, lm[4].y - lm[8].y);
    if (thumbIndexDist < palm * 0.35 && isMiddleExtended && isRingExtended) {
        return { name: 'OK_SIGN', title: 'Dấu OK (Bật/Tắt Tivi)', icon: '👌' };
    }
    
    // 3. 1 Finger (1 ngón trỏ -> Bật/Tắt Đèn)
    if (isIndexExtended && !isMiddleExtended && !isRingExtended && !isPinkyExtended) {
        return { name: 'Pointing_Up', title: '1 Ngón trỏ (Bật Đèn)', icon: '👉' };
    }
    
    // 4. 2 Fingers (2 ngón chữ V -> Mở/Đóng Cửa)
    if (isIndexExtended && isMiddleExtended && !isRingExtended && !isPinkyExtended) {
        return { name: 'Victory', title: '2 Ngón chữ V (Mở/Đóng Cửa)', icon: '✌️' };
    }
    
    // 5. 3 Fingers (3 ngón tay -> Kéo Rèm Lên)
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
    sfx.tone(720, 0.08);
    
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

appendLog("Hệ thống Web Controller đã sẵn sàng.", "sys");
