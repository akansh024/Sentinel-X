import socket
import threading
from Crypto.PublicKey import RSA
from Crypto.Cipher import AES, PKCS1_OAEP
import base64
from tkinter import Tk, Text, Button, Entry, Scrollbar, Label, END

class ChatClient:
    def __init__(self, master):
        self.master = master
        self.master.title("Sentinel-X")
        self.master.geometry("400x500")

        # Chat display area
        self.chat_area = Text(self.master, state="disabled", wrap="word", bg="lightgrey")
        self.chat_area.grid(row=0, column=0, columnspan=2, padx=10, pady=10, sticky="nsew")

        # Scrollbar
        scrollbar = Scrollbar(self.master, command=self.chat_area.yview)
        self.chat_area["yscrollcommand"] = scrollbar.set
        scrollbar.grid(row=0, column=2, sticky="ns")

        # Input field
        self.message_entry = Entry(self.master, width=30)
        self.message_entry.grid(row=1, column=0, padx=10, pady=10, sticky="ew")
        self.message_entry.bind("<Return>", self.send_message)

        # Send button
        self.send_button = Button(self.master, text="Send", command=self.send_message)
        self.send_button.grid(row=1, column=1, padx=10, pady=10)

        # Status label
        self.status_label = Label(self.master, text="Connecting...", bg="white", relief="sunken")
        self.status_label.grid(row=2, column=0, columnspan=3, sticky="we", padx=10, pady=5)

        # Configure grid weights for resizing
        self.master.grid_rowconfigure(0, weight=1)
        self.master.grid_columnconfigure(0, weight=1)
        self.master.grid_columnconfigure(1, weight=0)

        self.client = None
        self.aes_key = None
        self.connect_to_server()

    def connect_to_server(self):
        """Establish connection to the server and perform key exchange."""
        try:
            self.client = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            self.client.connect(("localhost", 4040))  

            # Receive server's public key
            server_pub_key = self.client.recv(4096)
            server_rsa_key = RSA.import_key(server_pub_key)

            # Generate RSA key pair for the client
            client_key = RSA.generate(2048)
            client_public_key = client_key.publickey()

            # Send client's public key to the server
            self.client.send(client_public_key.export_key())

            # Receive encrypted AES session key from the server
            encrypted_aes_key = self.client.recv(4096)
            cipher_rsa = PKCS1_OAEP.new(client_key)
            self.aes_key = cipher_rsa.decrypt(encrypted_aes_key)

            # Send client name
            self.client_name = "ClientUser"
            self.client.send(self.client_name.encode())

            self.status_label.config(text="Connected to server!")
            threading.Thread(target=self.receive_messages, daemon=True).start()
        except Exception as e:
            self.status_label.config(text=f"Connection error: {e}")

    def send_message(self, event=None):
        """Send an encrypted message to the server."""
        message = self.message_entry.get()
        if message.strip() and self.aes_key:
            try:
                cipher_aes = AES.new(self.aes_key, AES.MODE_EAX)
                nonce = cipher_aes.nonce
                ciphertext, tag = cipher_aes.encrypt_and_digest(message.encode())
                encrypted_message = base64.b64encode(nonce + tag + ciphertext)
                self.client.send(encrypted_message)

                # Display the message in the chat area
                self.update_chat_area(f"You: {message}\n")
                self.message_entry.delete(0, END)
            except Exception as e:
                self.update_chat_area(f"Error sending message: {e}\n")

    def receive_messages(self):
        """Receive and decrypt messages from the server."""
        while True:
            try:
                encrypted_message = self.client.recv(4096)
                decoded_message = base64.b64decode(encrypted_message)
                nonce = decoded_message[:16]
                tag = decoded_message[16:32]
                ciphertext = decoded_message[32:]

                cipher_aes = AES.new(self.aes_key, AES.MODE_EAX, nonce=nonce)
                decrypted_message = cipher_aes.decrypt_and_verify(ciphertext, tag).decode()

                self.master.after(0, self.update_chat_area, f"Server: {decrypted_message}\n")
            except Exception as e:
                self.master.after(0, self.update_chat_area, f"Error receiving message: {e}\n")
                break

    def update_chat_area(self, message):
        """Update the chat area in a thread-safe way."""
        self.chat_area.config(state="normal")
        self.chat_area.insert(END, message)
        self.chat_area.config(state="disabled")
        self.chat_area.see(END)

if __name__ == "__main__":
    root = Tk()
    app = ChatClient(root)
    root.mainloop()
