"""Reuse the immutable v1 single-question MP3s; produce versioned per-pack playlists."""
import hashlib
import json
from pathlib import Path
import sys
import wave

root = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(root / 'node_modules/.audio-tools'))
import lameenc

definitions = json.loads((root / 'src/fixtures/listening-packs.json').read_text(encoding='utf-8'))
questions = {q['id']: q for q in json.loads((root / 'src/fixtures/listening-part2.json').read_text(encoding='utf-8'))}
source = root / 'node_modules/.listening-wav'
result = []

def pcm(name):
    with wave.open(str(source / name), 'rb') as f:
        assert (f.getframerate(), f.getnchannels(), f.getsampwidth()) == (16000, 1, 2)
        return f.readframes(f.getnframes())

def metadata(path):
    data = (root / 'public' / path).read_bytes()
    return {'path': path, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}

for definition in definitions:
    pack = {**definition, 'questions': [], 'playlists': [], 'files': []}
    joined = bytearray()
    boundaries = []
    for qid in pack['question_ids']:
        q = questions[qid]
        assert q['status'] == 'approved'
        file = metadata(f'audio/part2-v1/{qid}.mp3')
        pack['questions'].append({'id': qid, 'version': q['version'], 'file': file})
        pack['files'].append(file)
        joined.extend(pcm(qid + '-question.wav'))
        joined.extend(bytes(5 * 32000))
        joined.extend(pcm(qid + '-review.wav'))
        joined.extend(bytes(2 * 32000))
        boundaries.append({'id': qid, 'end': len(joined) / 32000})
    encoded = {}
    directory = f"audio/part2-packs/{pack['id']}/v{pack['version']}"
    (root / 'public' / directory).mkdir(parents=True, exist_ok=True)
    for minutes in (5, 10, 15):
        chosen = [b for b in boundaries if b['end'] <= minutes * 60]
        assert chosen, 'A complete question must fit within five minutes'
        count = len(chosen)
        duration = chosen[-1]['end']
        if count not in encoded:
            path = f'{directory}/continuous-{count}.mp3'
            encoder = lameenc.Encoder()
            encoder.set_bit_rate(64)
            encoder.set_in_sample_rate(16000)
            encoder.set_channels(1)
            encoder.set_quality(2)
            data = encoder.encode(bytes(joined[:round(duration * 32000)])) + encoder.flush()
            target = root / 'public' / path
            # Never replace an already published asset under an immutable pack version.
            if target.exists() and target.read_bytes() != data:
                raise RuntimeError(f'Audio changed under an existing version: {path}. Bump the pack version.')
            target.write_bytes(data)
            encoded[count] = metadata(path)
            pack['files'].append(encoded[count])
        pack['playlists'].append({'minutes': minutes, 'ids': [b['id'] for b in chosen], 'duration': duration, 'file': encoded[count]})
    result.append(pack)

(root / 'src/fixtures/listening-pack-audio.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps([{'id': p['id'], 'questions': len(p['questions']), 'files': len(p['files']), 'bytes': sum(f['bytes'] for f in p['files'])} for p in result]))
