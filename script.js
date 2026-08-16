// --- 1. CẤU HÌNH FIREBASE ---
const firebaseConfig = {
  apiKey: "AIzaSyA5e5QwVu0cKXRLx743cEk74J4xPiEp9qA",
  authDomain: "music-box-87234.firebaseapp.com",
  databaseURL: "https://music-box-87234-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "music-box-87234",
  storageBucket: "music-box-87234.firebasestorage.app",
  messagingSenderId: "659368332742",
  appId: "1:659368332742:web:277268d8c509ededbdb6c7",
  measurementId: "G-HJWNMT9R5G"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.database();

const MY_ADMIN_CODE = "admin123";

// --- 2. BIẾN PHÒNG & WEBRTC CẤU HÌNH BỔ SUNG TURN SERVER ---
let localStream = null;
let isMicOn = true;
let isCamOn = true;
let currentRoomId = null;
let myUserId = "user_" + Math.random().toString(36).substr(2, 9);
let peerConnections = {};

const rtcConfig = {
    iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
        { urls: "stun:stun2.l.google.com:19302" },
        { urls: "stun:stun3.l.google.com:19302" },
        { urls: "stun:stun4.l.google.com:19302" }
    ]
};

// --- 3. QUẢN LÝ POPUP ADMIN ---
function openAdminModal() {
    document.getElementById('admin-modal').style.display = 'flex';
    setTimeout(() => {
        const input = document.getElementById('admin-code-input');
        if (input) input.focus();
    }, 100);
}

function closeAdminModal() {
    document.getElementById('admin-modal').style.display = 'none';
    const input = document.getElementById('admin-code-input');
    if (input) input.value = '';
}

function handleAdminSubmit(event) {
    event.preventDefault();
    verifyAdminCode();
}

function verifyAdminCode() {
    const inputCode = document.getElementById('admin-code-input').value.trim();
    if (inputCode === MY_ADMIN_CODE) {
        alert("Xác thực Admin thành công! Nút 'Tạo Phòng Mới' đã xuất hiện.");
        document.getElementById('btn-create-room').style.display = 'block';
        closeAdminModal();
    } else {
        alert("Sai Admin Code!");
        const input = document.getElementById('admin-code-input');
        if (input) {
            input.value = '';
            input.focus();
        }
    }
}

// --- 4. HÀM TẠO PHÒNG VÀ VÀO PHÒNG ---
async function createRoom() {
    const roomId = document.getElementById('room-id').value.trim();
    const roomPass = document.getElementById('room-pass').value.trim();
    const userName = document.getElementById('user-name').value.trim();

    if (!roomId || !roomPass || !userName) {
        alert("Vui lòng điền đầy đủ ID, Mật khẩu phòng và Tên hiển thị!");
        return;
    }

    const roomRef = db.ref(`rooms/${roomId}`);
    const snapshot = await roomRef.once('value');

    if (snapshot.exists()) {
        alert("ID Phòng này đã tồn tại! Vui lòng chọn ID khác.");
        return;
    }

    await roomRef.set({ password: roomPass });
    alert("Tạo phòng mới thành công!");

    await enterRoomProcess(roomId, userName);
}

async function joinRoom() {
    const roomId = document.getElementById('room-id').value.trim();
    const roomPass = document.getElementById('room-pass').value.trim();
    const userName = document.getElementById('user-name').value.trim();

    if (!roomId || !roomPass || !userName) {
        alert("Vui lòng điền đầy đủ thông tin!");
        return;
    }

    const roomRef = db.ref(`rooms/${roomId}`);
    const snapshot = await roomRef.once('value');

    if (!snapshot.exists()) {
        alert("Phòng không tồn tại! Hãy nhờ Admin tạo phòng trước.");
        return;
    }

    const roomData = snapshot.val();
    if (roomData.password !== roomPass) {
        alert("Mật khẩu phòng không chính xác!");
        return;
    }

    await enterRoomProcess(roomId, userName);
}

// --- 5. QUY TRÌNH KHI VÀO PHÒNG ---
async function enterRoomProcess(roomId, userName) {
    currentRoomId = roomId;

    document.getElementById('display-room-id').innerText = roomId;
    document.getElementById('local-name-tag').innerText = userName + " (Bạn)";
    document.getElementById('local-avatar').innerText = userName.charAt(0).toUpperCase();

    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('room-screen').style.display = 'flex';

    await initMedia();

    const myUserRef = db.ref(`rooms/${roomId}/users/${myUserId}`);
    await myUserRef.set({
        name: userName,
        isMicOn: isMicOn,
        isCamOn: isCamOn
    });

    myUserRef.onDisconnect().remove();

    listenForUsers(roomId);
    listenForSignaling(roomId);
    listenForMusicBox(roomId);
}

async function initMedia() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        const localVideo = document.getElementById('local-video');
        localVideo.srcObject = localStream;
        localVideo.muted = true; // Bắt buộc mute video chính mình để tránh vọng tiếng
        
        isMicOn = true;
        isCamOn = true;
        updateMicUI(true);
        updateCamUI(true);
        updateUserStatusUI(myUserId, true, true);
    } catch (error) {
        console.warn("Chưa cấp quyền Mic/Cam:", error);
        isMicOn = false;
        isCamOn = false;
        updateMicUI(false);
        updateCamUI(false);
        updateUserStatusUI(myUserId, false, false);
    }
}

// --- 6. XỬ LÝ WEBRTC HOÀN CHỈNH ---
function createPeerConnection(remoteUserId) {
    if (peerConnections[remoteUserId]) return peerConnections[remoteUserId];

    const pc = new RTCPeerConnection(rtcConfig);
    peerConnections[remoteUserId] = pc;

    // Gửi tracks của mình sang cho remote user
    if (localStream) {
        localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
    }

    // Nhận stream từ remote user
    pc.ontrack = (event) => {
        const remoteVideo = document.getElementById(`video-${remoteUserId}`);
        if (remoteVideo) {
            remoteVideo.srcObject = event.streams[0];
            remoteVideo.autoplay = true;
            remoteVideo.playsInline = true;
            
            // Tự động phát âm thanh/video
            remoteVideo.play().catch(e => {
                console.log("Trình duyệt chặn tự động phát, thử phát lại...", e);
                document.addEventListener('click', () => remoteVideo.play(), { once: true });
            });
        }
    };

    // Gửi ICE Candidates
    pc.onicecandidate = (event) => {
        if (event.candidate) {
            db.ref(`rooms/${currentRoomId}/candidates/${remoteUserId}/${myUserId}`).push(event.candidate.toJSON());
        }
    };

    return pc;
}

async function makeOffer(remoteUserId) {
    const pc = createPeerConnection(remoteUserId);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    db.ref(`rooms/${currentRoomId}/offers/${remoteUserId}/${myUserId}`).set({
        type: offer.type,
        sdp: offer.sdp
    });
}

function listenForSignaling(roomId) {
    // 1. Lắng nghe Offer gửi tới mình
    db.ref(`rooms/${roomId}/offers/${myUserId}`).on('child_added', async (snapshot) => {
        const fromUserId = snapshot.key;
        const offer = snapshot.val();

        const pc = createPeerConnection(fromUserId);
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        db.ref(`rooms/${roomId}/answers/${fromUserId}/${myUserId}`).set({
            type: answer.type,
            sdp: answer.sdp
        });
    });

    // 2. Lắng nghe Answer trả về cho Offer của mình
    db.ref(`rooms/${roomId}/answers/${myUserId}`).on('child_added', async (snapshot) => {
        const fromUserId = snapshot.key;
        const answer = snapshot.val();
        const pc = peerConnections[fromUserId];

        if (pc && !pc.currentRemoteDescription) {
            await pc.setRemoteDescription(new RTCSessionDescription(answer));
        }
    });

    // 3. Lắng nghe ICE Candidates
    db.ref(`rooms/${roomId}/candidates/${myUserId}`).on('child_added', (snapshot) => {
        const fromUserId = snapshot.key;
        
        db.ref(`rooms/${roomId}/candidates/${myUserId}/${fromUserId}`).on('child_added', async (candidateSnap) => {
            const candidateData = candidateSnap.val();
            const pc = peerConnections[fromUserId];
            
            if (pc && candidateData) {
                try {
                    await pc.addIceCandidate(new RTCIceCandidate(candidateData));
                } catch (e) {
                    console.error("Lỗi thêm ICE Candidate:", e);
                }
            }
        });
    });
}

// --- 7. LẮNG NGHE NGƯỜI DÙNG VÀ TẠO KHUNG ---
function listenForUsers(roomId) {
    const usersRef = db.ref(`rooms/${roomId}/users`);

    usersRef.on('child_added', (snapshot) => {
        const userId = snapshot.key;
        const userData = snapshot.val();

        if (userId !== myUserId) {
            createRemoteUserCard(userId, userData.name);
            updateUserStatusUI(userId, userData.isMicOn, userData.isCamOn);
            
            // Người vào sau chủ động kết nối tới người vào trước
            makeOffer(userId);
        }
    });

    usersRef.on('child_changed', (snapshot) => {
        const userId = snapshot.key;
        const userData = snapshot.val();
        updateUserStatusUI(userId, userData.isMicOn, userData.isCamOn);
    });

    usersRef.on('child_removed', (snapshot) => {
        const userId = snapshot.key;
        removeRemoteUserCard(userId);
        if (peerConnections[userId]) {
            peerConnections[userId].close();
            delete peerConnections[userId];
        }
    });
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

function updateUserStatusUI(userId, micActive, camActive) {
    let micBadge, camBadge, remoteVideo, remoteAvatar;

    if (userId === myUserId) {
        micBadge = document.getElementById('local-mic-badge');
        camBadge = document.getElementById('local-cam-badge');
    } else {
        micBadge = document.getElementById(`mic-badge-${userId}`);
        camBadge = document.getElementById(`cam-badge-${userId}`);
        remoteVideo = document.getElementById(`video-${userId}`);
        remoteAvatar = document.getElementById(`avatar-${userId}`);
    }

    if (micBadge) {
        micBadge.innerText = micActive ? "🎙️" : "🔇";
        micBadge.className = `badge-icon ${micActive ? '' : 'off'}`;
    }

    if (camBadge) {
        camBadge.innerText = camActive ? "📹" : "🚫";
        camBadge.className = `badge-icon ${camActive ? '' : 'off'}`;
    }

    if (userId !== myUserId && remoteVideo && remoteAvatar) {
        remoteVideo.style.display = camActive ? 'block' : 'none';
        remoteAvatar.style.display = camActive ? 'none' : 'flex';
    }
}

// --- 8. KHUNG CHỌN BÀI HÁT & LYRIC ---
function filterSongs() {
    const query = document.getElementById('song-search').value.toLowerCase();
    const items = document.querySelectorAll('.song-item');
    items.forEach(item => {
        const title = item.querySelector('.song-title').innerText.toLowerCase();
        const artist = item.querySelector('.song-artist').innerText.toLowerCase();
        if (title.includes(query) || artist.includes(query)) {
            item.style.display = 'flex';
        } else {
            item.style.display = 'none';
        }
    });
}

function startKaraoke(title, artist) {
    const songData = { title, artist, isPlaying: true };
    if (currentRoomId) {
        db.ref(`rooms/${currentRoomId}/currentSong`).set(songData);
    } else {
        renderKaraokeUI(songData);
    }
}

function returnToSelection() {
    if (currentRoomId) {
        db.ref(`rooms/${currentRoomId}/currentSong`).set({ isPlaying: false });
    } else {
        renderSelectionUI();
    }
}

function renderKaraokeUI(songData) {
    document.getElementById('selection-screen').classList.remove('active');
    document.getElementById('lyric-screen').classList.add('active');
    document.getElementById('playing-song-info').innerText = `🎤 Đang hát: ${songData.title} - ${songData.artist}`;
}

function renderSelectionUI() {
    document.getElementById('lyric-screen').classList.remove('active');
    document.getElementById('selection-screen').classList.add('active');
}

function listenForMusicBox(roomId) {
    db.ref(`rooms/${roomId}/currentSong`).on('value', (snapshot) => {
        const data = snapshot.val();
        if (data && data.isPlaying) {
            renderKaraokeUI(data);
        } else {
            renderSelectionUI();
        }
    });
}

// --- 9. ĐIỀU KHIỂN BẬT / TẮT MIC & CAM ---
async function toggleMic() {
    if (!localStream) return;
    const audioTrack = localStream.getAudioTracks()[0];

    if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        isMicOn = audioTrack.enabled;
    }

    updateMicUI(isMicOn);
    updateUserStatusUI(myUserId, isMicOn, isCamOn);
    if (currentRoomId) {
        db.ref(`rooms/${currentRoomId}/users/${myUserId}`).update({ isMicOn: isMicOn });
    }
}

async function toggleCam() {
    if (!localStream) return;
    const videoTrack = localStream.getVideoTracks()[0];

    if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        isCamOn = videoTrack.enabled;
    }

    updateCamUI(isCamOn);
    updateUserStatusUI(myUserId, isMicOn, isCamOn);
    if (currentRoomId) {
        db.ref(`rooms/${currentRoomId}/users/${myUserId}`).update({ isCamOn: isCamOn });
    }
}

function updateMicUI(on) {
    const btn = document.getElementById('mic-btn');
    document.getElementById('mic-label').innerText = on ? "Tắt Mic" : "Bật Mic";
    btn.classList.toggle('off', !on);
}

function updateCamUI(on) {
    const btn = document.getElementById('cam-btn');
    document.getElementById('local-video').style.display = on ? 'block' : 'none';
    document.getElementById('local-avatar').style.display = on ? 'none' : 'flex';
    document.getElementById('cam-label').innerText = on ? "Tắt Cam" : "Bật Cam";
    btn.classList.toggle('off', !on);
}

function leaveRoom() {
    if (currentRoomId) {
        db.ref(`rooms/${currentRoomId}/users/${myUserId}`).remove();
    }
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
    }
    location.reload();
}