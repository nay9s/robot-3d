"""Regenerate the browser copy after editing the canonical C++ header."""
from pathlib import Path
root = Path(__file__).resolve().parents[1]
header = (root / 'ArduinoProj/encoder_motion/EncoderMotion.h').read_text()
assert '`' not in header and '${' not in header
(root / 'encoder-motion-source.js').write_text(
    '// Generated from ArduinoProj/encoder_motion/EncoderMotion.h by tests/sync-encoder-controller.py\n'
    'export const ENCODER_MOTION_SOURCE = String.raw`' + header + '`;\n')
