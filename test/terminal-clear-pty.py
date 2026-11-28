"""Exercise the installed Ink renderer in a Unix PTY or a Windows ConPTY."""
import os
from pathlib import Path
from select import select
from tempfile import TemporaryDirectory
from time import monotonic

import pyte

if os.name == "nt":
    from winpty import PtyProcess
    from winpty.enums import Backend
else:
    from ptyprocess import PtyProcessUnicode as PtyProcess


def verify():
    cli = Path(__file__).resolve().parents[1] / "dist" / "cli.js"
    with TemporaryDirectory() as home, TemporaryDirectory() as workspace:
        env = dict(os.environ, HOME=home, USERPROFILE=home, TERM="xterm-256color",
                   CI="false", VERTEX_UI_THEME="warm-dark")
        env.pop("MOCK_TTY", None)
        opts = {"backend": str(Backend.ConPTY)} if os.name == "nt" else {}
        proc = PtyProcess.spawn(["node", str(cli)], cwd=workspace, env=env,
                                dimensions=(30, 100), **opts)
        screen = pyte.Screen(100, 30)
        stream = pyte.Stream(screen)

        def wait_for(predicate):
            deadline = monotonic() + 15
            while monotonic() < deadline:
                if select([proc.fileobj if os.name == "nt" else proc.fd], [], [], 0.1)[0]:
                    stream.feed(proc.read(8192))
                else:
                    frame = "\n".join(row.rstrip() for row in screen.display)
                    if predicate(frame):
                        return frame
            raise AssertionError("\n".join(screen.display))

        def submit(text):
            proc.write(text)
            wait_for(lambda frame: "❯  " + text in frame)
            proc.write("\r")

        try:
            wait_for(lambda frame: "Trust this workspace" in frame)
            proc.write("1")
            wait_for(lambda frame: "Welcome to VERTEX" in frame)
            resets = []
            for _ in range(2):
                submit("whoami")
                wait_for(lambda frame: "COMPLETED" in frame)
                submit("/clear")
                frame = wait_for(lambda f: f.count("Welcome to VERTEX") == 1
                                 and "Enter send" in f and "/clear" not in f and "COMPLETED" not in f)
                assert frame.count("❯") == 1
                assert "TASK SUMMARY" not in frame and "Output:" not in frame
                resets.append(frame)
            assert resets[0] == resets[1], "The second /clear left a different viewport"
            submit("/exit")
        finally:
            proc.close(force=True)


if __name__ == "__main__":
    verify()
    print("Repeated /clear produced identical clean terminal screens.")
