import socket
import threading
from Crypto.PublicKey import RSA
from Crypto.Cipher import AES, PKCS1_OAEP
from Crypto.Random import get_random_bytes
import base64

# Generate RSA key pair
key = RSA.generate(2048)
private_key = key
public_key = key.publickey()

clients = {}

def broadcast(message, sender_socket):
    """Broadcast message to all clients except the sender."""
    for client in clients:
        if client != sender_socket:
            try:
                client.send(message)
            except Exception as e:
                print(f"Error broadcasting to {clients[client]['name']}: {e}")

def handle_client(client_socket, client_address):
    """Handle communication with a single client."""
    print(f"New connection: {client_address}")
    try:
        # Send the server's public key
        client_socket.send(public_key.export_key())

        # Receive the client's public key
        client_pub_key = client_socket.recv(4096)
        client_rsa_key = RSA.import_key(client_pub_key)

        # Securely exchange AES session key
        aes_key = get_random_bytes(16)
        cipher_rsa = PKCS1_OAEP.new(client_rsa_key)
        encrypted_aes_key = cipher_rsa.encrypt(aes_key)
        client_socket.send(encrypted_aes_key)

        # Receive client name
        client_name = client_socket.recv(1024).decode()
        clients[client_socket] = {'name': client_name, 'aes_key': aes_key}

        print(f"{client_name} has joined the chat.")

        while True:
            try:
                # Receive and decrypt the message
                encrypted_message = client_socket.recv(4096)
                if not encrypted_message:
                    print(f"{client_name} has disconnected.")
                    break

                decoded_message = base64.b64decode(encrypted_message)
                nonce = decoded_message[:16]
                tag = decoded_message[16:32]
                ciphertext = decoded_message[32:]

                cipher_aes = AES.new(aes_key, AES.MODE_EAX, nonce=nonce)
                decrypted_message = cipher_aes.decrypt_and_verify(ciphertext, tag).decode()

                print(f"{client_name}: {decrypted_message}")

                # Broadcast the message to other clients
                broadcast(encrypted_message, client_socket)
            except Exception as e:
                print(f"Error handling message from {client_name}: {e}")
                break
    except Exception as e:
        print(f"Error during connection setup with {client_address}: {e}")
    finally:
        print(f"Closing connection with {client_address}")
        if client_socket in clients:
            del clients[client_socket]
        client_socket.close()

def start_server():
    """Start the chat server."""
    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.bind(('0.0.0.0', 4040))  

    server.listen(5)
    print("Server started. Waiting for connections...")

    while True:
        client_socket, client_address = server.accept()
        thread = threading.Thread(target=handle_client, args=(client_socket, client_address))
        thread.start()

if __name__ == "__main__":
    start_server()





