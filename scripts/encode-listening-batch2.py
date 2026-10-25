"""Encode only second-batch singles to an independent, immutable audio directory."""
import hashlib
import json
from pathlib import Path
import sys
import wave

root = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(root / 'node_modules/.audio-tools'))
import lameenc

fixture = root / 'src/fixtures/listening-part2-batch2.json'
questions = json.loads(fixture.read_text(encoding='utf-8'))
output = root / 'public/audio/part2-batch2-v1'
output.mkdir(parents=True, exist_ok=True)
manifest_path = root / 'src/fixtures/listening-batch2-audio.json'
manifest = {'version': 'part2-batch2-v1', 'voice': 'Microsoft Zira Desktop (en-US)',
            'source_sha256': hashlib.sha256(fixture.read_bytes()).hexdigest(), 'files': []}
encoded = []
for q in questions:
    assert q['status'] == 'approved'
    with wave.open(str(root / 'node_modules/.listening-wav' / f"{q['id']}-question.wav"), 'rb') as stream:
        assert (stream.getframerate(), stream.getnchannels(), stream.getsampwidth()) == (16000, 1, 2)
        pcm = stream.readframes(stream.getnframes())
    encoder = lameenc.Encoder()
    encoder.set_bit_rate(64)
    encoder.set_in_sample_rate(16000)
    encoder.set_channels(1)
    encoder.set_quality(2)
    data = encoder.encode(pcm) + encoder.flush()
    name = f"{q['id']}.mp3"
    target = output / name
    if target.exists() and target.read_bytes() != data:
        raise RuntimeError(f'Audio changed under immutable part2-batch2-v1: {name}. Use a new version.')
    encoded.append((target, data))
    manifest['files'].append({'name': name, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
if manifest_path.exists() and json.loads(manifest_path.read_text(encoding='utf-8')) != manifest:
    raise RuntimeError('Existing second-batch manifest differs. Use a new version.')
for target, data in encoded:
    if not target.exists():
        target.write_bytes(data)
manifest_path.write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
print(f'Encoded {len(encoded)} second-batch singles.')
