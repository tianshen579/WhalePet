"""Build with Gradle 8.11.1; a local Android SDK and JDK 17+ are required."""
import hashlib
import os
from pathlib import Path
import shutil
import subprocess
import sys
import urllib.request
import zipfile

root = Path(__file__).resolve().parent
sdk = os.environ.get('ANDROID_HOME') or os.environ.get('ANDROID_SDK_ROOT')
if not sdk and not (root/'local.properties').exists():
    sys.exit('Android SDK missing: install Android SDK Platform 35 and set ANDROID_HOME, or set sdk.dir in local.properties.')
if not shutil.which('java'):
    sys.exit('Java is missing. Install JDK 17 and add its bin directory to PATH.')
version = '8.11.1'
cache = Path.home()/'.cache'/'whalepet-build'
gradle = cache/f'gradle-{version}'/'bin'/('gradle.bat' if os.name == 'nt' else 'gradle')
if not gradle.exists():
    cache.mkdir(parents=True, exist_ok=True)
    filename = f'gradle-{version}-bin.zip'
    url = f'https://services.gradle.org/distributions/{filename}'
    expected = urllib.request.urlopen(url+'.sha256', timeout=45).read().decode().split()[0]
    package = cache/filename
    print('Downloading Gradle from the official distribution service...')
    urllib.request.urlretrieve(url, package)
    if hashlib.sha256(package.read_bytes()).hexdigest() != expected:
        package.unlink(missing_ok=True)
        sys.exit('Gradle checksum mismatch; download discarded.')
    with zipfile.ZipFile(package) as z:
        for entry in z.namelist():
            if not (cache/entry).resolve().is_relative_to(cache.resolve()):
                sys.exit('Unsafe path in Gradle archive.')
        z.extractall(cache)
    if os.name != 'nt':
        gradle.chmod(0o755)
command = [str(gradle), '--no-daemon', ':app:assembleDebug']
if os.name == 'nt':
    command = ['cmd', '/c'] + command
subprocess.run(command, cwd=root, check=True)
print('APK:', root/'app/build/outputs/apk/debug/app-debug.apk')
