"""Encode original local speech to MP3; no credential or external speech service."""
import hashlib
import json
from pathlib import Path
import sys
import wave

root = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(root / 'node_modules/.audio-tools'))
import lameenc

source = root / 'node_modules/.listening-wav'
output = root / 'public/audio/part2-v1'
output.mkdir(parents=True, exist_ok=True)
questions = json.loads((root / 'src/fixtures/listening-part2.json').read_text(encoding='utf-8'))
manifest = {'version': 'part2-v1', 'voice': 'Microsoft Zira Desktop (en-US)', 'files': [], 'tracks': []}

def read(name):
    with wave.open(str(source / name), 'rb') as f:
        assert f.getframerate() == 16000 and f.getnchannels() == 1 and f.getsampwidth() == 2
        return f.readframes(f.getnframes())

def encode(pcm, name):
    encoder = lameenc.Encoder()
    encoder.set_bit_rate(64)
    encoder.set_in_sample_rate(16000)
    encoder.set_channels(1)
    encoder.set_quality(2)
    data = encoder.encode(pcm) + encoder.flush()
    target = output / name
    if target.exists() and target.read_bytes() != data:
        raise RuntimeError(f'Audio changed under immutable part2-v1: {name}. Use a new audio version.')
    target.write_bytes(data)
    manifest['files'].append({'name': name, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()})

joined = bytearray()
for q in questions:
    pcm = read(q['id'] + '-question.wav')
    review = read(q['id'] + '-review.wav')
    # 每題五秒思考後提供英文答案與解說，再保留兩秒轉場。
    start = len(joined) / 32000
    joined.extend(pcm)
    joined.extend(bytes(5 * 32000))
    joined.extend(review)
    joined.extend(bytes(2 * 32000))
    manifest['tracks'].append({'id': q['id'], 'start': start, 'end': len(joined) / 32000, 'question_duration': len(pcm) / 32000})
    encode(pcm, q['id'] + '.mp3')
manifest['playlists'] = []
for minutes in (5, 10, 15):
    tracks = [t for t in manifest['tracks'] if t['end'] <= minutes * 60]
    assert tracks
    end = tracks[-1]['end']
    name = f'continuous-{minutes}.mp3'
    encode(bytes(joined[:round(end * 32000)]), name)
    manifest['playlists'].append({'minutes': minutes, 'name': name, 'ids': [t['id'] for t in tracks], 'duration': end})
(root / 'src/fixtures/listening-audio.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
print(f"Encoded {len(questions)} questions, {len(joined)/32000:.1f} seconds of continuous audio, {sum(f['bytes'] for f in manifest['files'])/1024/1024:.1f} MiB.")
