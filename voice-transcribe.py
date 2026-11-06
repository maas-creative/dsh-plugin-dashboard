import json, subprocess, sys, tempfile
import mlx_whisper

audio = sys.stdin.buffer.read(700001)
if not audio or len(audio) > 700000:
    raise ValueError('invalid audio size')
with tempfile.NamedTemporaryFile(suffix='.audio') as source, tempfile.NamedTemporaryFile(suffix='.wav') as wave:
    source.write(audio)
    source.flush()
    subprocess.run(['/opt/homebrew/bin/ffmpeg', '-v', 'error', '-y', '-i', source.name, '-t', '30', '-ac', '1', '-ar', '16000', wave.name], check=True, timeout=20, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    result = mlx_whisper.transcribe(wave.name, path_or_hf_repo='mlx-community/whisper-large-v3-turbo', language='ja', verbose=False)
print(json.dumps({'text': result['text'].strip()}, ensure_ascii=False))
