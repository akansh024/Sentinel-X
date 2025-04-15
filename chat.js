// Supabase setup - Replace with your credentials
const supabaseUrl = 'https://sudchtocfhhwctctqdfk.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN1ZGNodG9jZmhod2N0Y3RxZGZrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDQ1NjY3NDUsImV4cCI6MjA2MDE0Mjc0NX0.S7iBl3zuUJyQ1zbjmOqaWtcaADJpKepxnAvn5xyiv64';
const supabase = supabase.createClient(supabaseUrl, supabaseKey);

// Encryption keys (in-memory for this session)
let sharedKeys = {}; // Format: { userId: cryptoKey }
let currentUser = null;
let currentReceiver = null;
let typingTimeout = null;

// DOM elements
const messagesContainer = document.getElementById('chat-messages');
const messageInput = document.getElementById('message-input');
const sendBtn = document.getElementById('send-btn');
const userListDiv = document.getElementById('user-list');
const searchInput = document.getElementById('search-input');
const contactStatus = document.getElementById('contact-status');
const typingIndicator = document.getElementById('typing-indicator');
const userAvatar = document.getElementById('user-avatar');
const chatHeaderAvatar = document.querySelector('#chat-header .user-avatar');
const chatHeaderName = document.querySelector('#chat-header .user-name');

// Initialize
async function initChat() {
    // Check auth
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
        window.location.href = '/login';
        return;
    }
    
    currentUser = user;
    updateUserAvatar(user);
    
    // Load user list
    await loadUsers();
    
    // Set up real-time messaging
    setupRealtime();
    
    // Event listeners
    sendBtn.addEventListener('click', sendMessage);
    messageInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendMessage();
    });
    
    // Typing indicator
    messageInput.addEventListener('input', handleTyping);
    
    // Search functionality
    searchInput.addEventListener('input', debounce(loadUsers, 300));
}

function updateUserAvatar(user) {
    const initials = user.email.substring(0, 2).toUpperCase();
    userAvatar.textContent = initials;
}

// Load all users (with search functionality)
async function loadUsers() {
    const searchTerm = searchInput.value.trim();
    let query = supabase
        .from('users')
        .select('id, username, created_at')
        .neq('id', currentUser.id);
    
    if (searchTerm) {
        query = query.ilike('username', `%${searchTerm}%`);
    }
    
    const { data: users, error } = await query;
    
    if (error) {
        console.error('Error loading users:', error);
        return;
    }
    
    renderUserList(users);
}

function renderUserList(users) {
    userListDiv.innerHTML = '';
    
    users.forEach(user => {
        const userElement = document.createElement('div');
        userElement.className = 'user-item';
        userElement.innerHTML = `
            <div class="user-avatar">${user.username.substring(0, 2).toUpperCase()}</div>
            <div class="user-info">
                <div class="user-name">${user.username}</div>
                <div class="user-status">
                    <span class="status-indicator"></span>
                    <span>Online</span>
                </div>
            </div>
        `;
        
        userElement.addEventListener('click', () => startChat(user.id, user.username));
        userListDiv.appendChild(userElement);
    });
}

// Start chat with selected user
async function startChat(userId, username) {
    currentReceiver = userId;
    
    // Update UI
    document.querySelectorAll('.user-item').forEach(el => el.classList.remove('active'));
    event.currentTarget.classList.add('active');
    chatHeaderName.textContent = username;
    chatHeaderAvatar.textContent = username.substring(0, 2).toUpperCase();
    contactStatus.textContent = 'Online';
    
    // Load previous messages
    const { data: messages, error } = await supabase
        .from('messages')
        .select('*')
        .or(`and(sender_id.eq.${currentUser.id},receiver_id.eq.${userId}),and(sender_id.eq.${userId},receiver_id.eq.${currentUser.id})`)
        .order('created_at', { ascending: true });

    if (error) {
        console.error('Error loading messages:', error);
        return;
    }

    messagesContainer.innerHTML = '';
    for (const message of messages) {
        await displayMessage(message);
    }
    
    // Scroll to bottom
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// Display a message
async function displayMessage(message) {
    const isSent = message.sender_id === currentUser.id;
    
    // Decrypt message
    const decrypted = await decryptMessage(
        message.encrypted_content, 
        sharedKeys[isSent ? message.receiver_id : message.sender_id]
    );
    
    if (decrypted) {
        const timeString = new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${isSent ? 'sent' : 'received'}`;
        messageDiv.innerHTML = `
            ${decrypted}
            <span class="message-time">
                ${timeString}
                ${isSent ? '<i class="fas fa-check-double message-status"></i>' : ''}
            </span>
        `;
        
        messagesContainer.appendChild(messageDiv);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
}

// Send message
async function sendMessage() {
    const message = messageInput.value.trim();
    if (!message || !currentReceiver) return;
    
    // Generate or retrieve encryption key
    if (!sharedKeys[currentReceiver]) {
        sharedKeys[currentReceiver] = await generateKey();
    }

    // Encrypt message
    const encrypted = await encryptMessage(message, sharedKeys[currentReceiver]);
    
    // Save to Supabase
    const { error } = await supabase
        .from('messages')
        .insert([{
            sender_id: currentUser.id,
            receiver_id: currentReceiver,
            encrypted_content: encrypted
        }]);

    if (error) {
        console.error('Error sending message:', error);
    } else {
        messageInput.value = '';
        hideTypingIndicator();
    }
}

// Typing indicator handlers
function handleTyping() {
    showTypingIndicator();
    
    if (typingTimeout) {
        clearTimeout(typingTimeout);
    }
    
    typingTimeout = setTimeout(hideTypingIndicator, 2000);
}

function showTypingIndicator() {
    if (!typingIndicator.style.display || typingIndicator.style.display === 'none') {
        typingIndicator.style.display = 'flex';
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
}

function hideTypingIndicator() {
    typingIndicator.style.display = 'none';
}

// Realtime setup
function setupRealtime() {
    // Messages channel
    const messagesChannel = supabase.channel('messages')
        .on(
            'postgres_changes',
            { 
                event: 'INSERT', 
                schema: 'public', 
                table: 'messages',
                filter: `or(receiver_id.eq.${currentUser.id},sender_id.eq.${currentUser.id})`
            },
            async (payload) => {
                if (payload.new.receiver_id === currentUser.id || payload.new.sender_id === currentUser.id) {
                    await displayMessage(payload.new);
                }
            }
        )
        .subscribe();
    
    // Presence channel for online status
    const presenceChannel = supabase.channel('presence')
        .on('presence', { event: 'sync' }, () => {
            console.log('Online users:', presenceChannel.presenceState());
        })
        .on('presence', { event: 'join' }, ({ key, newPresences }) => {
            console.log('New users online:', newPresences);
        })
        .on('presence', { event: 'leave' }, ({ key, leftPresences }) => {
            console.log('Users offline:', leftPresences);
        });
    
    presenceChannel.subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
            await presenceChannel.track({
                user_id: currentUser.id,
                online_at: new Date().toISOString()
            });
        }
    });
}

// Encryption functions
async function generateKey() {
    return await window.crypto.subtle.generateKey(
        { name: "AES-GCM", length: 256 },
        true,
        ["encrypt", "decrypt"]
    );
}

async function encryptMessage(message, key) {
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(message);
    const ciphertext = await window.crypto.subtle.encrypt(
        { name: "AES-GCM", iv },
        key,
        encoded
    );
    return {
        iv: Array.from(iv),
        ciphertext: Array.from(new Uint8Array(ciphertext))
    };
}

async function decryptMessage(encrypted, key) {
    try {
        const decrypted = await window.crypto.subtle.decrypt(
            { name: "AES-GCM", iv: new Uint8Array(encrypted.iv) },
            key,
            new Uint8Array(encrypted.ciphertext)
        );
        return new TextDecoder().decode(decrypted);
    } catch (err) {
        console.error("Decryption failed:", err);
        return null;
    }
}

// Utility functions
function debounce(func, timeout = 300) {
    let timer;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => { func.apply(this, args); }, timeout);
    };
}

// Initialize chat when page loads
document.addEventListener('DOMContentLoaded', initChat);