"""Host-only control tests. Requires g++ and Node (NODE env or PATH). No hardware."""
from pathlib import Path
import os, subprocess, tempfile
root = Path(__file__).resolve().parents[1]
def run(args, **kwargs):
    subprocess.run(args, cwd=root, check=True, **kwargs)
with tempfile.TemporaryDirectory(prefix='robot-control-') as tmp:
    for test in ['encoder-motion', 'combined-failure']:
        exe = str(Path(tmp)/test)
        run(['g++','-std=c++17','-Itests/arduino-stubs',f'tests/{test}.test.cpp','-o',exe])
        run([exe])
    run([os.environ.get('NODE','node'),'tests/exporter-controller.test.mjs'],
        env={**os.environ,'ROBOT_TEST_OUTPUT':tmp})
    for source in Path(tmp).glob('*.ino'):
        run(['g++','-std=c++17','-x','c++','-Itests/arduino-stubs','-fsyntax-only',str(source)])
    run(['g++','-std=c++17','-x','c++','-include','tests/arduino-stubs/Arduino.h',
         '-Itests/arduino-stubs','-fsyntax-only','ArduinoProj/combined_encoder_v3/combined_encoder_v3.ino'])
print('All host checks passed. These do not validate traction, gains or physical distance.')
