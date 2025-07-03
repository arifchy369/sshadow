import asyncio
import websockets
import sys
import tty
import json
import os
import termios
import argparse
import getpass


fd = sys.stdin.fileno()
old_setting = termios.tcgetattr(fd)


intro = "©2025 Arif Chowdhury \r\nAll rights reserved.\n\r"

def exit_shell():
    termios.tcsetattr(fd, termios.TCSADRAIN, old_setting)
    os._exit(0)

def get_terminal_size():
    cols, rows = os.get_terminal_size()
    return cols, rows

async def read_input():
    loop = asyncio.get_event_loop()
    try:
        input_data = await loop.run_in_executor(None, lambda: os.read(fd, 10000))
        return input_data.decode()
    except Exception as e:
        print(f"Error reading input: {e}")
        return ""

async def send_input(ws):
    try:
        while True:
            command = await read_input()
            if command:
                await ws.send(json.dumps({"type": "input", "data": command}))
    except websockets.ConnectionClosed:
        print("\n[Connection closed]\r\n")
        exit_shell()
    except Exception as e:
        print(f"Error in send_input: {e}\r\n")
        exit_shell()

async def receive_output(ws):
    try:
        async for message in ws:
            response = json.loads(message)
            if response["type"] == "output":
                data = response["data"]
                print(data, end="", flush=True)
            elif response["type"] == "auth":
                if response["status"] == "failure":
                    print("Authentication failed!\r")
                    await ws.close()
                    exit_shell()
                elif response["status"] == "success":
                    print("Authentication successful!\r\n")
                    print(intro)
    except websockets.ConnectionClosed:
        print("\n[Disconnected from server]\r\n")
        exit_shell()

async def send_resize(ws):
    last_size = None
    try:
        while True:
            await asyncio.sleep(0.5)
            cols, rows = get_terminal_size()
            if last_size != (cols, rows):
                last_size = (cols, rows)
                await ws.send(json.dumps({"type": "resize", "data": {"cols": cols, "rows": rows}}))
    except:
        exit_shell()

async def main(host, username, password):
    try:
        async with websockets.connect(host) as ws:
            await ws.send(json.dumps({"username": username, "password": password}))
            await asyncio.gather(
                send_input(ws),
                receive_output(ws),
                send_resize(ws)
            )
    except websockets.ConnectionClosed:
        print("\n[Server closed connection]\r\n")
        exit_shell()
    except Exception as e:
        print(f"\n[Connection error: {e}]\r\n")
        exit_shell()

def format_url(url):
    url = url.strip()
    if url.startswith("ws://") or url.startswith("wss://"):
        return url
    if url.startswith("http://"):
        return "ws://" + url[len("http://"):]
    if url.startswith("https://"):
        return "wss://" + url[len("https://"):]
    return "wss://" + url


def parse_args():
    parser = argparse.ArgumentParser(description="WebSocket Terminal Client")
    parser.add_argument('-H', '--host', help="Host URL (http(s):// or ws(s)://)")
    parser.add_argument('-u', '--username', help="Username")
    parser.add_argument('-p', '--password', help="Password")
    args = parser.parse_args()

    host_input = args.host or input("Enter Host URL: ")
    host = format_url(host_input)
    username = args.username or input("Enter Username: ")
    password = args.password or getpass.getpass("Enter Password: ")

    return host, username, password



try:
    host, username, password = parse_args()
    tty.setraw(fd)
    asyncio.run(main(host, username, password))
except Exception as e:
    print(f"\n[Startup error: {e}]")
    exit_shell()
