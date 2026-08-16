// --- 1. CẤU HÌNH FIREBASE ---
const firebaseConfig = {
  apiKey: "AIzaSyA5e5QwVu0cKXRLx743cEk74J4xPiEp9qA",
  authDomain: "music-box-87234.firebaseapp.com",
  databaseURL: "https://music-box-87234-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "music-box-87234",
  storageBucket: "music-box-87234.firebasestorage.app",
  messagingSenderId: "659368332742",
  appId: "1:659368332742:web:277268d8c509ededbdb6c7"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.database();

const MY_ADMIN_CODE = "admin123";

// --- 2. BIẾN PHÒNG & PEERJS ---
let localStream = null;
let isMicOn = true;
let isCamOn = true;
let currentRoomId = null;
let myUserId = "user_" + Math.random().toString(36).substr(2, 6);
let peer = null;
let calls = {};

// Cấu hình ICE Server bao gồm cả STUN & TURN
const peerConfig = {
    config: {
        iceServers: [
            { urls: "stun:stun.l.google.com:19302" },
            { urls: "stun:stun1.l.google.com:19302" },
            {
                urls: "turn:openrelay.metered.ca:80",
                username: "openrelayproject",
                credential: "openrelayproject"
            },
            {
                urls: "turn:openrelay.metered.ca:443",
                username: "openrelayproject",
                credential: "openrelayproject"
            }
        ]
    }
};

// --- 3. QUẢN LÝ POPUP ADMIN ---
function openAdminModal() {
    document.getElementById('admin-modal').style.display = 'flex';
}
function closeAdminModal() {
    document.getElementById('admin-modal').style.display = 'none';
}
function handleAdminSubmit(e) {
    e.preventDefault();
    const inputCode = document.getElementById('admin-code-input').value.trim();
    if (inputCode === MY_ADMIN_CODE) {
        alert("Xác thực Admin thành công!");
        document.getElementById('btn-create-room').style.display = 'block';
        closeAdminModal();
    } else {
        alert("Sai Admin Code!");
    }
}

// --- 4. THAM GIA & TẠO PHÒNG ---
async function createRoom() {
    const roomId = document.getElementById('room-id').value.trim();
    const roomPass = document.getElementById('room-pass').value.trim();
    const userName = document.getElementById('user-name').value.trim();

    if (!roomId || !roomPass || !userName) return alert("Vui lòng nhập đủ thông tin!");

    const roomRef = db.ref(`rooms/${roomId}`);
    const snapshot = await roomRef.once('value');
    if (snapshot.exists()) return alert("ID Phòng đã tồn tại!");

    await roomRef.set({ password: roomPass });
    enterRoomProcess(roomId, userName);
}

async function joinRoom() {
    const roomId = document.getElementById('room-id').value.trim();
    const roomPass = document.getElementById('room-pass').value.trim();
    const userName = document.getElementById('user-name').value.trim();

    if (!roomId || !roomPass || !userName) return alert("Vui lòng nhập đủ thông tin!");

    const roomRef = db.ref(`rooms/${roomId}`);
    const snapshot = await roomRef.once('value');
    if (!snapshot.exists()) return alert("Phòng không tồn tại!");
    if (snapshot.val().password !== roomPass) return alert("Sai mật khẩu!");

    enterRoomProcess(roomId, userName);
}

// --- 5. TIẾN TRÌNH TRONG PHÒNG ---
async function enterRoomProcess(roomId, userName) {
    currentRoomId = roomId;

    document.getElementById('display-room-id').innerText = roomId;
    document.getElementById('local-name-tag').innerText = userName + " (Bạn)";
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('room-screen').style.display = 'flex';

    await initMedia();
    initPeerJS(userName);

    listenForMusicBox(roomId);
}

async function initMedia() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        const localVid = document.getElementById('local-video');
        localVid.srcObject = localStream;
        localVid.muted = true; // Luôn mute camera của chính mình
    } catch (e) {
        console.warn("Chưa cấp quyền Mic/Cam đầy đủ:", e);
    }
}

// --- 6. KHỞI TẠO KẾT NỐI PEERJS (XỬ LÝ VIDEO/AUDIO CHUẨN) ---
function initPeerJS(userName) {
    // Khởi tạo Peer với ID ngẫu nhiên
    peer = new Peer(myUserId, peerConfig);

    peer.on('open', (id) => {
        // Đăng ký thông tin vào Firebase
        const myUserRef = db.ref(`rooms/${currentRoomId}/users/${myUserId}`);
        myUserRef.set({ name: userName, isMicOn: true, isCamOn: true });
        myUserRef.onDisconnect().remove();

        // Lắng nghe người dùng khác
        listenForUsers();
    });

    // Lắng nghe cuộc gọi đến (khi người khác gọi cho mình)
    peer.on('call', (call) => {
        call.answer(localStream); // Trả lời cuộc gọi bằng local stream
        
        call.on('stream', (remoteStream) => {
            addRemoteStream(call.peer, remoteStream);
        });

        calls[call.peer] = call;
    });
}

function listenForUsers() {
    const usersRef = db.ref(`rooms/${currentRoomId}/users`);

    usersRef.on('child_added', (snapshot) => {
        const userId = snapshot.key;
        const userData = snapshot.val();

        if (userId !== myUserId) {
            createRemoteUserCard(userId, userData.name);
            
            // Gọi cho người vừa vào phòng
            if (localStream) {
                const call = peer.call(userId, localStream);
                call.on('stream', (remoteStream) => {
                    addRemoteStream(userId, remoteStream);
                });
                calls[userId] = call;
            }
        }
    });

    usersRef.on('child_removed', (snapshot) => {
        const userId = snapshot.key;
        removeRemoteUserCard(userId);
        if (calls[userId]) {
            calls[userId].close();
            delete calls[userId];
        }
    });
}

function addRemoteStream(userId, stream) {
    const remoteVideo = document.getElementById(`video-${userId}`);
    if (remoteVideo) {
        remoteVideo.srcObject = stream;
        remoteVideo.autoplay = true;
        remoteVideo.playsInline = true;
        
        // Tự động phát video & nghe tiếng
        remoteVideo.play().catch(() => {
            window.addEventListener('click', () => remoteVideo.play(), { once: true });
        });
    }
}

function createRemoteUserCard(userId, userName) {
    if (document.getElementById(`card-${userId}`)) return;

    const container = document.getElementById('participants-container');
    const userCard = document.createElement('div');
    userCard.className = 'user-card';
    userCard.id = `card-${userId}`;

    userCard.innerHTML = `
        <video id="video-${userId}" class="user-video" autoplay playsinline></video>
        <div id="avatar-${userId}" class="user-avatar" style="display:none;">${userName.charAt(0).toUpperCase()}</div>
        <div class="status-badge">
            <span id="mic-badge-${userId}" class="badge-icon">🎙️</span>
            <span id="cam-badge-${userId}" class="badge-icon">📹</span>
        </div>
        <span class="user-name">${userName}</span>
    `;
    container.appendChild(userCard);
}

function removeRemoteUserCard(userId) {
    const card = document.getElementById(`card-${userId}`);
    if (card) card.remove();
}

// --- 7. ĐIỀU KHIỂN BẬT / TẮT MIC & CAM ---
function toggleMic() {
    if (!localStream) return;
    const audioTrack = localStream.getAudioTracks()[0];
    if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        isMicOn = audioTrack.enabled;
        updateMicUI(isMicOn);
    }
}

function toggleCam() {
    if (!localStream) return;
    const videoTrack = localStream.getVideoTracks()[0];
    if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        isCamOn = videoTrack.enabled;
        updateCamUI(isCamOn);
    }
}

function updateMicUI(on) {
    document.getElementById('mic-label').innerText = on ? "Tắt Mic" : "Bật Mic";
    document.getElementById('mic-btn').classList.toggle('off', !on);
}

function updateCamUI(on) {
    document.getElementById('local-video').style.display = on ? 'block' : 'none';
    document.getElementById('local-avatar').style.display = on ? 'none' : 'flex';
    document.getElementById('cam-label').innerText = on ? "Tắt Cam" : "Bật Cam";
    document.getElementById('cam-btn').classList.toggle('off', !on);
}

// --- 8. CHỌN BÀI HÁT & LYRIC ---
function filterSongs() {
    const query = document.getElementById('song-search').value.toLowerCase();
    document.querySelectorAll('.song-item').forEach(item => {
        const title = item.querySelector('.song-title').innerText.toLowerCase();
        item.style.display = title.includes(query) ? 'flex' : 'none';
    });
}

function startKaraoke(title, artist) {
    db.ref(`rooms/${currentRoomId}/currentSong`).set({ title, artist, isPlaying: true });
}

function returnToSelection() {
    db.ref(`rooms/${currentRoomId}/currentSong`).set({ isPlaying: false });
}

function listenForMusicBox(roomId) {
    db.ref(`rooms/${roomId}/currentSong`).on('value', (snapshot) => {
        const data = snapshot.val();
        if (data && data.isPlaying) {
            document.getElementById('selection-screen').classList.remove('active');
            document.getElementById('lyric-screen').classList.add('active');
            document.getElementById('playing-song-info').innerText = `🎤 Đang hát: ${data.title} - ${data.artist}`;
        } else {
            document.getElementById('lyric-screen').classList.remove('active');
            document.getElementById('selection-screen').classList.add('active');
        }
    });
}

function leaveRoom() {
    if (currentRoomId) db.ref(`rooms/${currentRoomId}/users/${myUserId}`).remove();
    if (localStream) localStream.getTracks().forEach(t => t.stop());
    location.reload();
}