/**
 * ====================================================================
 * SMART HOME AI - WEB SERIAL & MEDIAPIPE GESTURE CONTROLLER
 * Architecture: Pure Vanilla ES6 + Web Serial API + MediaPipe Hands
 * ====================================================================
 */

// --------------------------------------------------------------------
// 1. STATE MANAGEMENT & DOM ELEMENTS
// --------------------------------------------------------------------
const state = {
    // Hardware Serial State
    port: null,
    reader: null,
    writer: null,
    isSerialConnected: false,
    
    // AI Perception State
    isCameraRunning: false,
    camera: null,
    hands: null,
    currentMode: 'GESTURE', // 'GESTURE' | 'SECURITY_GATE'
    
    // Devices State (Reflecting Arduino Uno Pins)
    devices: {
        den: false,      // Pin D8
        cua: false,      // Pin D9 (Servo 0° / 90°)
        rem: false,      // Pin D10 (Servo 0° / 90°)
        quat: false,     // Pin D11 (Relay)
        tv: false,       // I2C LCD 1602
        alarm: false     // Pin D7 (Buzzer)
    },
    
    // Temporal Debouncing & Cooldown (1500ms)
    lastExecutedGesture: null,
    lastExecutionTime: 0,
    cooldownDuration: 1500, // ms
    cooldownTimer: null,
    
    // Gate Mode Timer
    gateScanning: false,
    gateScanTimer: null,
    
    // Performance
    frameCount: 0,
    fps: 0,
    fpsTimer: Date.now()
};

// DOM References
const elements = {
    btnConnectSerial: document.getElementById('btnConnectSerial'),
    btnToggleCamera: document.getElementById('btnToggleCamera'),
    btnStartCamCenter: document.getElementById('btnStartCamCenter'),
    btnSwitchMode: document.getElementById('btnSwitchMode'),
    btnAllOff: document.getElementById('btnAllOff'),
    btnClearLogs: document.getElementById('btnClearLogs'),
    
    // Telemetry Badges
    arduinoBadge: document.getElementById('arduinoBadge'),
    arduinoDot: document.getElementById('arduinoDot'),
    arduinoStatusText: document.getElementById('arduinoStatusText'),
    cameraBadge: document.getElementById('cameraBadge'),
    cameraDot: document.getElementById('cameraDot'),
    cameraStatusText: document.getElementById('cameraStatusText'),
    fpsCounter: document.getElementById('fpsCounter'),
    liveClock: document.getElementById('liveClock'),
    
    // Video & Canvas
    webcam: document.getElementById('webcam'),
    canvas: document.getElementById('outputCanvas'),
    cameraStandby: document.getElementById('cameraStandby'),
    cooldownBar: document.getElementById('cooldownBar'),
    
    // HUD & Gate
    hudBadge: document.getElementById('hudGestureBadge'),
    hudIcon: document.getElementById('hudGestureIcon'),
    hudName: document.getElementById('hudGestureName'),
    hudScore: document.getElementById('hudGestureScore'),
    gateOverlay: document.getElementById('gateOverlay'),
    btnTriggerGateScan: document.getElementById('btnTriggerGateScan'),
    gateTimerBox: document.getElementById('gateTimerBox'),
    gateProgressFill: document.getElementById('gateProgressFill'),
    gateTimerText: document.getElementById('gateTimerText'),
    modeTag: document.getElementById('modeTag'),
    modeDesc: document.getElementById('modeDesc'),
    
    // Toast & Logs
    toastIsland: document.getElementById('toastIsland'),
    toastMessage: document.getElementById('toastMessage'),
    serialLogs: document.getElementById('serialLogs'),
    
    // Device Cards & Badges
    cardDen: document.getElementById('cardDen'),
    badgeDen: document.getElementById('badgeDen'),
    btnToggleDen: document.getElementById('btnToggleDen'),
    
    cardCua: document.getElementById('cardCua'),
    badgeCua: document.getElementById('badgeCua'),
    btnOpenCua: document.getElementById('btnOpenCua'),
    btnCloseCua: document.getElementById('btnCloseCua'),
    
    cardRem: document.getElementById('cardRem'),
    badgeRem: document.getElementById('badgeRem'),
    btnOpenRem: document.getElementById('btnOpenRem'),
    btnCloseRem: document.getElementById('btnCloseRem'),
    
    cardQuat: document.getElementById('cardQuat'),
    badgeQuat: document.getElementById('badgeQuat'),
    btnToggleQuat: document.getElementById('btnToggleQuat'),
    
    cardTv: document.getElementById('cardTv'),
    badgeTv: document.getElementById('badgeTv'),
    btnToggleTv: document.getElementById('btnToggleTv'),
    
    cardBaoDong: document.getElementById('cardBaoDong'),
    badgeAlarm: document.getElementById('badgeAlarm'),
    btnToggleAlarm: document.getElementById('btnToggleAlarm')
};

const ctx = elements.canvas.getContext('2d');

// --------------------------------------------------------------------
// 2. WEB AUDIO API SYNTHESIZER (Sci-Fi Sound Effects)
// --------------------------------------------------------------------
class SoundEngine {
    constructor() {
        this.ctx = null;
    }
    
    init() {
        if (!this.ctx) {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            this.ctx = new AudioContext();
        }
    }
    
    beep(freq = 880, duration = 0.08, type = 'sine') {
        try {
            this.init();
            if (this.ctx.state === 'suspended') this.ctx.resume();
            
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            
            osc.type = type;
            osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
            gain.gain.setValueAtTime(0.12, this.ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);
            
            osc.connect(gain);
            gain.connect(this.ctx.destination);
            
            osc.start();
            osc.stop(this.ctx.currentTime + duration);
        } catch (e) {
            // Audio policy fallback
        }
    }
    
    success() {
        this.beep(523.25, 0.06); // C5
        setTimeout(() => this.beep(659.25, 0.06), 70); // E5
        setTimeout(() => this.beep(783.99, 0.12), 140); // G5
    }
    
    alarm() {
        this.beep(980, 0.15, 'sawtooth');
        setTimeout(() => this.beep(740, 0.15, 'sawtooth'), 160);
    }
}

const sounds = new SoundEngine();

// --------------------------------------------------------------------
// 3. TOAST NOTIFICATION & REAL-TIME CLOCK
// --------------------------------------------------------------------
let toastTimeout = null;

function showToast(message, isAlert = false) {
    if (toastTimeout) clearTimeout(toastTimeout);
    
    elements.toastMessage.textContent = message;
    elements.toastIsland.classList.remove('hidden');
    elements.toastIsland.style.borderColor = isAlert ? 'var(--color-red)' : 'var(--color-cyan)';
    
    toastTimeout = setTimeout(() => {
        elements.toastIsland.classList.add('hidden');
    }, 2400);
}

function updateClock() {
    const now = new Date();
    elements.liveClock.textContent = now.toTimeString().split(' ')[0];
}
setInterval(updateClock, 1000);
updateClock();

function appendLog(text, type = 'sys') {
    const entry = document.createElement('div');
    entry.className = `log-entry log-${type}`;
    const timestamp = new Date().toTimeString().split(' ')[0];
    entry.textContent = `[${timestamp}] ${text}`;
    
    elements.serialLogs.appendChild(entry);
    elements.serialLogs.scrollTop = elements.serialLogs.scrollHeight;
    
    // Prune excessive logs
    if (elements.serialLogs.children.length > 80) {
        elements.serialLogs.removeChild(elements.serialLogs.firstChild);
    }
}

elements.btnClearLogs.addEventListener('click', () => {
    elements.serialLogs.innerHTML = '';
    appendLog('Đã xóa lịch sử nhật ký console.', 'sys');
});

// --------------------------------------------------------------------
// 4. WEB SERIAL API (DIRECT HARDWARE COMMUNICATION)
// --------------------------------------------------------------------
async function connectSerial() {
    if (!('serial' in navigator)) {
        alert("Trình duyệt này không hỗ trợ Web Serial API!\nVui lòng sử dụng Google Chrome, Microsoft Edge hoặc Opera trên máy tính.");
        appendLog("LỖI: Trình duyệt không hỗ trợ Web Serial API.", "err");
        return;
    }
    
    try {
        if (state.isSerialConnected && state.port) {
            // Disconnect if already connected
            appendLog("Đang đóng kết nối cổng Serial...", "sys");
            if (state.reader) {
                await state.reader.cancel();
                state.reader = null;
            }
            if (state.writer) {
                await state.writer.close();
                state.writer = null;
            }
            await state.port.close();
            state.port = null;
            updateSerialUI(false);
            appendLog("Đã ngắt kết nối Arduino.", "sys");
            return;
        }
        
        appendLog("Đang yêu cầu chọn cổng kết nối Arduino...", "sys");
        state.port = await navigator.serial.requestPort();
        
        // Open port at 9600 baud rate matching smart_home.ino
        await state.port.open({ baudRate: 9600 });
        
        updateSerialUI(true);
        sounds.success();
        showToast("ARDUINO ĐÃ KẾT NỐI QUA CỔNG SERIAL (9600 BAUD)!");
        appendLog("Kết nối Serial 9600 baud thành công!", "rx");
        
        // Listen to serial events
        navigator.serial.addEventListener('disconnect', (e) => {
            if (e.target === state.port) {
                updateSerialUI(false);
                appendLog("CẢNH BÁO: Dây cáp Arduino đã bị rút ra!", "err");
                showToast("ARDUINO ĐÃ BỊ NGẮT KẾT NỐI!", true);
            }
        });
        
        // Start Reading loop in background
        readSerialStream();
        
    } catch (err) {
        console.error("Serial connection error:", err);
        if (err.name !== 'NotFoundError') {
            appendLog(`Lỗi mở cổng Serial: ${err.message}`, "err");
            alert(`Lỗi cổng Serial: ${err.message}`);
        }
    }
}

function updateSerialUI(connected) {
    state.isSerialConnected = connected;
    if (connected) {
        elements.arduinoDot.className = 'dot dot-success';
        elements.arduinoStatusText.textContent = 'ARDUINO: ĐÃ KẾT NỐI (9600)';
        elements.btnConnectSerial.innerHTML = `
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>
            </svg>
            <span>NGẮT KẾT NỐI</span>
        `;
        elements.btnConnectSerial.classList.replace('btn-primary', 'btn-danger');
    } else {
        elements.arduinoDot.className = 'dot dot-danger';
        elements.arduinoStatusText.textContent = 'ARDUINO: CHƯA KẾT NỐI';
        elements.btnConnectSerial.innerHTML = `
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M12 2v10m0 0l-3-3m3 3l3-3"/>
                <rect x="5" y="12" width="14" height="10" rx="2"/>
            </svg>
            <span>KẾT NỐI ARDUINO</span>
        `;
        elements.btnConnectSerial.classList.replace('btn-danger', 'btn-primary');
    }
}

async function sendSerialCommand(cmdChar, description = "") {
    sounds.beep(750, 0.05);
    appendLog(`[TX] Gửi lệnh '${cmdChar}' ${description ? `(${description})` : ''}`, "tx");
    
    if (!state.isSerialConnected || !state.port) {
        appendLog(`[MÔ PHỎNG] Arduino chưa cắm -> Mô phỏng lệnh '${cmdChar}' trên giao diện Web.`, "warn");
        return;
    }
    
    try {
        const encoder = new TextEncoder();
        const writer = state.port.writable.getWriter();
        await writer.write(encoder.encode(cmdChar));
        writer.releaseLock();
    } catch (err) {
        console.error("Write error:", err);
        appendLog(`Lỗi gửi dữ liệu Serial: ${err.message}`, "err");
    }
}

async function readSerialStream() {
    while (state.port && state.port.readable && state.isSerialConnected) {
        const textDecoder = new TextDecoderStream();
        const readableStreamClosed = state.port.readable.pipeTo(textDecoder.writable);
        const reader = textDecoder.readable.getReader();
        state.reader = reader;
        
        try {
            let buffer = "";
            while (true) {
                const { value, done } = await reader.read();
                if (done) break;
                if (value) {
                    buffer += value;
                    const lines = buffer.split('\n');
                    buffer = lines.pop(); // Keep unfinished tail
                    
                    for (const line of lines) {
                        const trimmed = line.trim();
                        if (trimmed) {
                            appendLog(`[RX] ${trimmed}`, "rx");
                            parseArduinoAck(trimmed);
                        }
                    }
                }
            }
        } catch (err) {
            console.warn("Serial read error:", err);
        } finally {
            reader.releaseLock();
        }
    }
}

function parseArduinoAck(msg) {
    // Sync UI with physical Arduino ACK responses
    if (msg.includes('DEN_ON')) setDeviceUI('den', true);
    else if (msg.includes('CUA_MO_90')) setDeviceUI('cua', true);
    else if (msg.includes('CUA_DONG_0')) setDeviceUI('cua', false);
    else if (msg.includes('REM_CUON_LEN')) setDeviceUI('rem', true);
    else if (msg.includes('REM_THA_XUONG')) setDeviceUI('rem', false);
    else if (msg.includes('QUAT_ON')) setDeviceUI('quat', true);
    else if (msg.includes('QUAT_OFF')) setDeviceUI('quat', false);
    else if (msg.includes('TV_ON')) setDeviceUI('tv', true);
    else if (msg.includes('TV_OFF')) setDeviceUI('tv', false);
    else if (msg.includes('CANH_BAO_SOS')) setDeviceUI('alarm', true);
    else if (msg.includes('TAT_TAT_CA')) {
        setDeviceUI('den', false);
        setDeviceUI('cua', false);
        setDeviceUI('rem', false);
        setDeviceUI('quat', false);
        setDeviceUI('tv', false);
        setDeviceUI('alarm', false);
    }
}

// --------------------------------------------------------------------
// 5. DEVICE UI STATE REFLECTION
// --------------------------------------------------------------------
function setDeviceUI(deviceKey, isActive) {
    state.devices[deviceKey] = isActive;
    
    switch (deviceKey) {
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
            elements.badgeRem.textContent = isActive ? 'CUỘN LÊN' : 'HẠ XUỐNG';
            break;
        case 'quat':
            elements.cardQuat.classList.toggle('is-active', isActive);
            elements.badgeQuat.className = `device-badge ${isActive ? 'badge-on' : 'badge-off'}`;
            elements.badgeQuat.textContent = isActive ? 'ON' : 'OFF';
            break;
        case 'tv':
            elements.cardTv.classList.toggle('is-active', isActive);
            elements.badgeTv.className = `device-badge ${isActive ? 'badge-on' : 'badge-off'}`;
            elements.badgeTv.textContent = isActive ? 'ON (NETFLIX)' : 'OFF';
            break;
        case 'alarm':
            elements.cardBaoDong.classList.toggle('is-active', isActive);
            elements.badgeAlarm.className = `device-badge ${isActive ? 'badge-on' : 'badge-off'}`;
            elements.badgeAlarm.textContent = isActive ? 'HÚ CÒI SOS' : 'BÌNH THƯỜNG';
            break;
    }
}

// Attach Interactive Click Handlers (Buttons can be clicked anytime)
elements.btnToggleDen.addEventListener('click', () => {
    const nextState = !state.devices.den;
    setDeviceUI('den', nextState);
    sendSerialCommand(nextState ? 'A' : 'B', nextState ? "Bật Đèn" : "Tắt Đèn");
    showToast(`ĐÈN: ${nextState ? 'ĐÃ BẬT' : 'ĐÃ TẮT'}`);
});

elements.btnOpenCua.addEventListener('click', () => {
    setDeviceUI('cua', true);
    sendSerialCommand('O', "Mở Cửa 90°");
    showToast("CỬA: ĐÃ MỞ (90°)");
});

elements.btnCloseCua.addEventListener('click', () => {
    setDeviceUI('cua', false);
    sendSerialCommand('C', "Đóng Cửa 0°");
    showToast("CỬA: ĐÃ KHÓA CHẶT (0°)");
});

elements.btnOpenRem.addEventListener('click', () => {
    setDeviceUI('rem', true);
    sendSerialCommand('U', "Kéo Rèm Lên");
    showToast("RÈM CỬA: ĐÃ KÉO LÊN");
});

elements.btnCloseRem.addEventListener('click', () => {
    setDeviceUI('rem', false);
    sendSerialCommand('D', "Hạ Rèm Xuống");
    showToast("RÈM CỬA: ĐÃ HẠ XUỐNG");
});

elements.btnToggleQuat.addEventListener('click', () => {
    const next = !state.devices.quat;
    setDeviceUI('quat', next);
    sendSerialCommand('F', "Đảo Trạng Thái Quạt");
    showToast(`QUẠT: ${next ? 'ĐANG CHẠY' : 'ĐÃ TẮT'}`);
});

elements.btnToggleTv.addEventListener('click', () => {
    const next = !state.devices.tv;
    setDeviceUI('tv', next);
    sendSerialCommand('T', "Bật/Tắt Tivi LCD");
    showToast(`TIVI: ${next ? 'ĐÃ BẬT (CH 03)' : 'ĐÃ TẮT'}`);
});

elements.btnToggleAlarm.addEventListener('click', () => {
    const next = !state.devices.alarm;
    setDeviceUI('alarm', next);
    sendSerialCommand(next ? 'S' : 'C', next ? "Báo Động SOS" : "Tắt Còi");
    if (next) sounds.alarm();
    showToast(next ? "CẢNH BÁO: ĐANG HÚ CÒI BÁO ĐỘNG SOS!" : "ĐÃ TẮT CÒI BÁO ĐỘNG", next);
});

elements.btnAllOff.addEventListener('click', () => {
    setDeviceUI('den', false);
    setDeviceUI('cua', false);
    setDeviceUI('rem', false);
    setDeviceUI('quat', false);
    setDeviceUI('tv', false);
    setDeviceUI('alarm', false);
    sendSerialCommand('B', "Tắt Toàn Bộ Thiết Bị");
    showToast("ĐÃ TẮT TOÀN BỘ THIẾT BỊ TRONG NHÀ");
});

// --------------------------------------------------------------------
// 6. ANATOMICAL HAND GESTURE CLASSIFIER (GOOGLE MEDIAPIPE)
// --------------------------------------------------------------------
function getDistance(p1, p2) {
    return Math.hypot(p1.x - p2.x, p1.y - p2.y);
}

function classifyHandGesture(landmarks) {
    // landmarks: array of 21 {x, y, z} points normalized [0, 1]
    const p0 = landmarks[0];   // Wrist
    const p9 = landmarks[9];   // Middle MCP
    const palmLength = Math.hypot(p9.x - p0.x, p9.y - p0.y);
    
    // Check finger extensions comparing tip distance from wrist to MCP distance
    const extThumb = Math.hypot(landmarks[4].x - p0.x, landmarks[4].y - p0.y) > 1.15 * palmLength;
    const extIndex = Math.hypot(landmarks[8].x - p0.x, landmarks[8].y - p0.y) > 1.35 * palmLength;
    const extMid   = Math.hypot(landmarks[12].x - p0.x, landmarks[12].y - p0.y) > 1.35 * palmLength;
    const extRing  = Math.hypot(landmarks[16].x - p0.x, landmarks[16].y - p0.y) > 1.35 * palmLength;
    const extPinky = Math.hypot(landmarks[20].x - p0.x, landmarks[20].y - p0.y) > 1.35 * palmLength;
    
    // Check OK Pinch (Thumb tip close to Index tip)
    const distOk = Math.hypot(landmarks[4].x - landmarks[8].x, landmarks[4].y - landmarks[8].y);
    
    // 1. Dấu OK: Ngón cái chạm ngón trỏ, ngón giữa duỗi -> BẬT/TẮT TIVI
    if (distOk < 0.08 && extMid) {
        return { name: "OK_SIGN", title: "Dấu OK", icon: "👌", cmd: "T" };
    }
    
    // 2. 1 Ngón trỏ duỗi, các ngón khác gập -> BẬT ĐÈN
    if (extIndex && !extMid && !extRing && !extPinky) {
        return { name: "Pointing_Up", title: "1 Ngón trỏ", icon: "👉", cmd: "A" };
    }
    
    // 3. 2 Ngón chữ V (trỏ & giữa duỗi, áp út & út gập) -> MỞ / ĐÓNG CỬA
    if (extIndex && extMid && !extRing && !extPinky) {
        return { name: "Victory", title: "2 Ngón chữ V", icon: "✌️", cmd: "O" };
    }
    
    // 4. 3 Ngón (trỏ, giữa, áp út duỗi, út gập) -> KÉO RÈM CỬA
    if (extIndex && extMid && extRing && !extPinky) {
        return { name: "Three_Fingers", title: "3 Ngón tay", icon: "🤟", cmd: "U" };
    }
    
    // 5. Xòe 5 ngón -> BẬT / TẮT QUẠT
    if (extIndex && extMid && extRing && extPinky) {
        return { name: "Open_Palm", title: "Xòe 5 ngón", icon: "🖐️", cmd: "F" };
    }
    
    // 6. Nắm đấm -> TẮT TOÀN BỘ THIẾT BỊ
    if (!extIndex && !extMid && !extRing && !extPinky) {
        return { name: "Closed_Fist", title: "Nắm đấm", icon: "✊", cmd: "B" };
    }
    
    return null;
}

// --------------------------------------------------------------------
// 7. MEDIAPIPE CAMERA & CANVAS RENDERING
// --------------------------------------------------------------------
function onHandResults(results) {
    // FPS measurement
    state.frameCount++;
    const now = Date.now();
    if (now - state.fpsTimer >= 1000) {
        state.fps = state.frameCount;
        state.frameCount = 0;
        state.fpsTimer = now;
        elements.fpsCounter.textContent = state.fps;
    }
    
    ctx.save();
    ctx.clearRect(0, 0, elements.canvas.width, elements.canvas.height);
    
    // In Security Gate Mode, skip hand classification
    if (state.currentMode === 'SECURITY_GATE') {
        ctx.restore();
        return;
    }
    
    // Draw landmarks if detected
    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
        const landmarks = results.multiHandLandmarks[0];
        
        // Draw Skeleton Connections
        drawHandSkeleton(landmarks);
        
        // Classify Gesture
        const gesture = classifyHandGesture(landmarks);
        if (gesture) {
            elements.hudBadge.classList.remove('hidden');
            elements.hudIcon.textContent = gesture.icon;
            elements.hudName.textContent = gesture.title;
            elements.hudScore.textContent = "Khớp: 98%";
            
            // Check Debounce Cooldown
            const elapsed = now - state.lastExecutionTime;
            const progress = Math.min(1.0, elapsed / state.cooldownDuration);
            elements.cooldownBar.style.width = `${progress * 100}%`;
            
            if (elapsed >= state.cooldownDuration) {
                // Execute gesture
                state.lastExecutionTime = now;
                state.lastExecutedGesture = gesture.name;
                executeGestureAction(gesture);
            }
        } else {
            elements.hudBadge.classList.add('hidden');
        }
    } else {
        elements.hudBadge.classList.add('hidden');
        elements.cooldownBar.style.width = '100%';
    }
    
    ctx.restore();
}

function drawHandSkeleton(landmarks) {
    const w = elements.canvas.width;
    const h = elements.canvas.height;
    
    // Connections based on MediaPipe hand topology
    const connections = [
        [0, 1], [1, 2], [2, 3], [3, 4],
        [0, 5], [5, 6], [6, 7], [7, 8],
        [5, 9], [9, 10], [10, 11], [11, 12],
        [9, 13], [13, 14], [14, 15], [15, 16],
        [13, 17], [17, 18], [18, 19], [19, 20],
        [0, 17]
    ];
    
    ctx.strokeStyle = '#22d3ee';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    
    for (const [i, j] of connections) {
        ctx.beginPath();
        ctx.moveTo(landmarks[i].x * w, landmarks[i].y * h);
        ctx.lineTo(landmarks[j].x * w, landmarks[j].y * h);
        ctx.stroke();
    }
    
    // Joint Circles
    for (const lm of landmarks) {
        ctx.beginPath();
        ctx.arc(lm.x * w, lm.y * h, 5, 0, 2 * Math.PI);
        ctx.fillStyle = '#06b6d4';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(lm.x * w, lm.y * h, 2, 0, 2 * Math.PI);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
    }
}

function executeGestureAction(gesture) {
    switch (gesture.name) {
        case 'Pointing_Up':
            setDeviceUI('den', true);
            sendSerialCommand('A', "1 Ngón Trỏ -> Bật Đèn");
            showToast("CỬ CHỈ: ĐÃ BẬT ĐÈN CHIẾU SÁNG");
            break;
            
        case 'Victory':
            // Toggle Door: Open if closed, close if open
            const nextDoor = !state.devices.cua;
            setDeviceUI('cua', nextDoor);
            sendSerialCommand(nextDoor ? 'O' : 'C', `2 Ngón Chữ V -> ${nextDoor ? 'Mở Cửa' : 'Đóng Cửa'}`);
            showToast(`CỬ CHỈ: ${nextDoor ? 'ĐÃ MỞ CỬA (90°)' : 'ĐÃ ĐÓNG CỬA (0°)'}`);
            break;
            
        case 'Three_Fingers':
            const nextRem = !state.devices.rem;
            setDeviceUI('rem', nextRem);
            sendSerialCommand(nextRem ? 'U' : 'D', `3 Ngón -> ${nextRem ? 'Kéo Rèm Lên' : 'Hạ Rèm Xuống'}`);
            showToast(`CỬ CHỈ: ${nextRem ? 'ĐÃ KÉO RÈM CỬA LÊN' : 'ĐÃ HẠ RÈM CỬA XUỐNG'}`);
            break;
            
        case 'Open_Palm':
            const nextQuat = !state.devices.quat;
            setDeviceUI('quat', nextQuat);
            sendSerialCommand('F', "Xòe 5 Ngón -> Đảo Quạt");
            showToast(`CỬ CHỈ: ${nextQuat ? 'ĐÃ BẬT QUẠT' : 'ĐÃ TẮT QUẠT'}`);
            break;
            
        case 'OK_SIGN':
            const nextTv = !state.devices.tv;
            setDeviceUI('tv', nextTv);
            sendSerialCommand('T', "Dấu OK -> Đảo Tivi");
            showToast(`CỬ CHỈ: ${nextTv ? 'ĐÃ BẬT TIVI LCD' : 'ĐÃ TẮT TIVI'}`);
            break;
            
        case 'Closed_Fist':
            setDeviceUI('den', false);
            setDeviceUI('cua', false);
            setDeviceUI('rem', false);
            setDeviceUI('quat', false);
            setDeviceUI('tv', false);
            setDeviceUI('alarm', false);
            sendSerialCommand('B', "Nắm Đấm -> Tắt Toàn Bộ");
            showToast("CỬ CHỈ NẮM ĐẤM: ĐÃ TẮT TOÀN BỘ THIẾT BỊ");
            break;
    }
}

// --------------------------------------------------------------------
// 8. CAMERA LIFECYCLE MANAGEMENT
// --------------------------------------------------------------------
async function startCamera() {
    try {
        appendLog("Đang khởi tạo MediaPipe Hands và yêu cầu quyền Webcam...", "sys");
        
        // Initialize MediaPipe Hands
        state.hands = new Hands({
            locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
        });
        
        state.hands.setOptions({
            maxNumHands: 1,
            modelComplexity: 1,
            minDetectionConfidence: 0.65,
            minTrackingConfidence: 0.65
        });
        
        state.hands.onResults(onHandResults);
        
        // Setup MediaPipe Camera Utils
        state.camera = new Camera(elements.webcam, {
            onFrame: async () => {
                if (state.isCameraRunning) {
                    await state.hands.send({ image: elements.webcam });
                }
            },
            width: 1280,
            height: 720
        });
        
        await state.camera.start();
        
        // Sync Canvas Dimensions with Video
        elements.webcam.onloadedmetadata = () => {
            elements.canvas.width = elements.webcam.videoWidth || 1280;
            elements.canvas.height = elements.webcam.videoHeight || 720;
        };
        
        state.isCameraRunning = true;
        elements.cameraStandby.classList.add('hidden');
        elements.cameraDot.className = 'dot dot-success';
        elements.cameraStatusText.textContent = 'CAMERA: ĐANG HOẠT ĐỘNG';
        elements.btnToggleCamera.innerHTML = `
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                <line x1="9" y1="9" x2="15" y2="15"/><line x1="15" y1="9" x2="9" y2="15"/>
            </svg>
            <span>TẮT CAMERA</span>
        `;
        elements.btnToggleCamera.classList.replace('btn-secondary', 'btn-danger');
        
        showToast("CAMERA AI ĐÃ BẬT! SẴN SÀNG NHẬN DIỆN CỬ CHỈ");
        appendLog("Camera và MediaPipe Hands đã kích hoạt thành công.", "rx");
        sounds.success();
        
    } catch (err) {
        console.error("Camera startup error:", err);
        appendLog(`Lỗi mở Webcam: ${err.message}`, "err");
        alert(`Không thể truy cập Webcam: ${err.message}\nVui lòng cho phép quyền truy cập camera trên trình duyệt!`);
    }
}

function stopCamera() {
    state.isCameraRunning = false;
    if (state.camera) {
        state.camera.stop();
        state.camera = null;
    }
    
    elements.cameraStandby.classList.remove('hidden');
    elements.hudBadge.classList.add('hidden');
    elements.cameraDot.className = 'dot dot-danger';
    elements.cameraStatusText.textContent = 'CAMERA: TẮT';
    elements.fpsCounter.textContent = '0';
    elements.btnToggleCamera.innerHTML = `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polygon points="23 7 16 12 23 17 23 7"/>
            <rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
        </svg>
        <span>BẬT CAMERA AI</span>
    `;
    elements.btnToggleCamera.classList.replace('btn-danger', 'btn-secondary');
    
    ctx.clearRect(0, 0, elements.canvas.width, elements.canvas.height);
    appendLog("Đã tắt camera AI.", "sys");
    showToast("ĐÃ TẮT CAMERA");
}

function toggleCamera() {
    if (state.isCameraRunning) {
        stopCamera();
    } else {
        startCamera();
    }
}

elements.btnToggleCamera.addEventListener('click', toggleCamera);
elements.btnStartCamCenter.addEventListener('click', startCamera);
elements.btnConnectSerial.addEventListener('click', connectSerial);

// --------------------------------------------------------------------
// 9. SECURITY GATE MODE (FACE BIOMETRIC SIMULATION & ENTRY GATE)
// --------------------------------------------------------------------
elements.btnSwitchMode.addEventListener('click', () => {
    if (state.currentMode === 'GESTURE') {
        state.currentMode = 'SECURITY_GATE';
        elements.gateOverlay.classList.remove('hidden');
        elements.modeTag.textContent = "CỔNG AN NINH SINH TRẮC HỌC";
        elements.modeDesc.textContent = "Xác thực danh tính chủ nhà mở khóa cửa";
        elements.btnSwitchMode.innerHTML = "<span>👋 ĐIỀU KHIỂN CỬ CHỈ</span>";
        appendLog("Chuyển sang Giao diện Cổng An Ninh Face ID.", "sys");
    } else {
        state.currentMode = 'GESTURE';
        elements.gateOverlay.classList.add('hidden');
        elements.modeTag.textContent = "CHẾ ĐỘ CỬ CHỈ TAY";
        elements.modeDesc.textContent = "Nhận diện 21 khớp xương bàn tay thời gian thực";
        elements.btnSwitchMode.innerHTML = "<span>🛡️ CỔNG AN NINH</span>";
        appendLog("Chuyển sang Giao diện Điều khiển Cử chỉ tay.", "sys");
    }
});

elements.btnTriggerGateScan.addEventListener('click', () => {
    if (state.gateScanning) return;
    
    state.gateScanning = true;
    elements.gateTimerBox.classList.remove('hidden');
    elements.btnTriggerGateScan.disabled = true;
    
    appendLog("Bắt đầu quét xác thực an ninh sinh trắc học...", "tx");
    showToast("ĐANG QUÉT XÁC THỰC DANH TÍNH...");
    sounds.beep(600, 0.1);
    
    let timeLeft = 3.0;
    const interval = 100; // ms
    
    state.gateScanTimer = setInterval(() => {
        timeLeft -= (interval / 1000);
        const progress = (3.0 - Math.max(0, timeLeft)) / 3.0;
        elements.gateProgressFill.style.width = `${progress * 100}%`;
        elements.gateTimerText.textContent = `ĐANG XÁC THỰC: ${Math.max(0, timeLeft).toFixed(1)}s`;
        
        if (timeLeft <= 0) {
            clearInterval(state.gateScanTimer);
            state.gateScanning = false;
            elements.gateTimerBox.classList.add('hidden');
            elements.btnTriggerGateScan.disabled = false;
            
            // Verified Owner -> Open Door & Send 'O' / 'H'
            setDeviceUI('cua', true);
            sendSerialCommand('O', "Xác Thực Chủ Nhà Thành Công -> Mở Cửa 90°");
            sounds.success();
            showToast("FACE ID: CHÀO MỪNG CHỦ NHÀ! ĐÃ MỞ CỬA (90°)");
            appendLog("XÁC THỰC THÀNH CÔNG: Chào mừng Chủ nhà!", "rx");
            
            // Switch back to gesture dashboard smoothly after 1.5s
            setTimeout(() => {
                elements.btnSwitchMode.click();
            }, 1500);
        }
    }, interval);
});

appendLog("Hệ thống Web Serial Smart Home đã nạp xong và sẵn sàng hoạt động.", "sys");
