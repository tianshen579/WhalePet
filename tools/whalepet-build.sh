#!/usr/bin/env bash
# whalepet-build.sh — 免 Android SDK 构建 WhalePet APK
#
# 不依赖 Gradle 和 Android SDK，直接调 aapt / javac / d8 / apksigner 手搓。
# 适合没有 SDK 的环境，例如直接在手机上构建。
#
# 用法：
#   tools/whalepet-build.sh
#   TOOLCHAIN_DIR=/path/to/tools tools/whalepet-build.sh
#
# 需要的外部工具（见 docs/BUILD.md）：
#   javac / keytool   apt install openjdk-17-jdk-headless
#   aapt              apt install aapt        （必须是本机架构原生版本）
#   apksigner         apt install apksigner
#   zipalign          apt install zipalign
#   python3           生成清单与打二进制补丁用
#
# 两个 jar 会自动下载（纯 Java，跨架构通用）：
#   r8.jar           提供 d8（去 dex）
#   android-all.jar  提供 android.jar 与 API 35 的框架资源表
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="${WORK_DIR:-$SRC/build}"
TOOLCHAIN_DIR="${TOOLCHAIN_DIR:-$WORK/toolchain}"
APP="$SRC/app/src/main"

# 依赖下载地址。国内网络走的阿里云镜像。
R8_VERSION="${R8_VERSION:-9.5.20-dev}"
R8_URL="${R8_URL:-https://maven.aliyun.com/repository/google/com/android/tools/r8/$R8_VERSION/r8-$R8_VERSION.jar}"
ANDROID_ALL_VERSION="${ANDROID_ALL_VERSION:-15-robolectric-13954326}"   # API 35
ANDROID_ALL_URL="${ANDROID_ALL_URL:-https://repo1.maven.org/maven2/org/robolectric/android-all/$ANDROID_ALL_VERSION/android-all-$ANDROID_ALL_VERSION.jar}"

R8_JAR="$TOOLCHAIN_DIR/r8.jar"
ANDROID_JAR="$TOOLCHAIN_DIR/android-all.jar"
# aapt 需要一份它能解析的框架资源表。
# 注意：不要用 android-all.jar 里的 resources.arsc —— 那是 API 35 的新格式，
# aapt 会报 "Entry offset ... points outside the Type's boundaries"。
# Debian/Ubuntu 的 android-framework-res 提供的是 API 33 的表，可以用；
# 代价是 specialUse 这个 API 34 的枚举值要靠构建期补丁补上（见第 5 步）。
FRAMEWORK_APK="${FRAMEWORK_APK:-/usr/share/android-framework-res/framework-res.apk}"

die() { echo "✗ $*" >&2; exit 1; }

echo "== 0/8 检查工具链 =="
for t in javac keytool aapt apksigner zipalign python3 curl unzip zip; do
  command -v "$t" >/dev/null 2>&1 || die "缺少 $t（安装说明见 docs/BUILD.md）"
done
mkdir -p "$TOOLCHAIN_DIR" "$WORK"

fetch() { # url dest
  [ -f "$2" ] && { echo "   已有 $(basename "$2")"; return; }
  echo "   下载 $(basename "$2") …"
  curl -fSL --retry 3 -o "$2.part" "$1" || die "下载失败: $1"
  mv "$2.part" "$2"
}
fetch "$R8_URL" "$R8_JAR"
fetch "$ANDROID_ALL_URL" "$ANDROID_JAR"

[ -f "$FRAMEWORK_APK" ] || die "找不到框架资源表: $FRAMEWORK_APK
   Debian/Ubuntu: sudo apt install android-framework-res
   其他环境: 把 FRAMEWORK_APK 指向一份 aapt 能解析的 framework-res.apk"
echo "   框架资源表: $FRAMEWORK_APK"

rm -rf "$WORK/gen" "$WORK/classes" "$WORK/dex"
mkdir -p "$WORK/gen" "$WORK/classes" "$WORK/dex"

echo "== 1/8 生成构建用清单 =="
python3 - "$APP/AndroidManifest.xml" "$WORK/AndroidManifest.xml" <<'PY'
import sys
src, dst = sys.argv[1], sys.argv[2]
out = open(src).read()
# AGP 8 用 namespace，aapt v1 要求清单里有 package 属性
out = out.replace('<manifest xmlns:android="http://schemas.android.com/apk/res/android">',
    '<manifest xmlns:android="http://schemas.android.com/apk/res/android"\n    package="io.github.tianshen579.whalepet">', 1)
# specialUse 是 API 34 的枚举值，先换成 API 33 认识的值，产物出来再改回去
out = out.replace('android:foregroundServiceType="specialUse"',
                  'android:foregroundServiceType="dataSync"')
open(dst, "w").write(out)
print("   ok")
PY

echo "== 2/8 链接资源（aapt） =="
aapt package -f -m -M "$WORK/AndroidManifest.xml" \
  -S "$APP/res" -A "$APP/assets" \
  -I "$FRAMEWORK_APK" -J "$WORK/gen" \
  --min-sdk-version 26 --target-sdk-version 35 \
  -F "$WORK/app.ap_" 2>&1 | grep -vE '^$' || true
[ -f "$WORK/app.ap_" ] || die "资源链接失败"
echo "   app.ap_ = $(stat -c%s "$WORK/app.ap_") 字节"

echo "== 3/8 编译 Java（javac） =="
javac -nowarn -source 17 -target 17 -encoding UTF-8 \
  -classpath "$ANDROID_JAR" -d "$WORK/classes" \
  $(find "$WORK/gen" -name '*.java') "$APP"/java/io/github/tianshen579/whalepet/*.java 2>&1 \
  | grep -vE 'bootstrap class path|source value 17|target value 17|^Note:' || true
[ -n "$(find "$WORK/classes" -name '*.class' -print -quit)" ] || die "编译失败"
echo "   $(find "$WORK/classes" -name '*.class' | wc -l) 个 class"

echo "== 4/8 转 dex（d8） =="
find "$WORK/classes" -name '*.class' > "$WORK/classlist.txt"
java -Xmx1400m -cp "$R8_JAR" com.android.tools.r8.D8 \
  --lib "$ANDROID_JAR" --min-api 26 --release --output "$WORK/dex" \
  $(cat "$WORK/classlist.txt") 2>&1 | grep -vE '^Warning|^ *Superclass|desugaring of' || true
[ -f "$WORK/dex/classes.dex" ] || die "dex 失败"
echo "   classes.dex = $(stat -c%s "$WORK/dex/classes.dex") 字节"

echo "== 5/8 打包 + 清单补丁 =="
cp "$WORK/app.ap_" "$WORK/unsigned.apk"
(cd "$WORK/dex" && zip -q "$WORK/unsigned.apk" classes.dex)
python3 - "$WORK/unsigned.apk" "$WORK/patched.apk" <<'PY'
import sys, zipfile, struct
src, dst = sys.argv[1], sys.argv[2]
zin = zipfile.ZipFile(src)
mf = bytearray(zin.read('AndroidManifest.xml'))

# 解析 ResStringPool_header（28 字节）
_, _, _, strcount, _, flags, strstart, _ = struct.unpack_from('<HHIIIIII', mf, 8)
utf8 = bool(flags & (1 << 8))
offsets = struct.unpack_from(f'<{strcount}I', mf, 8 + 28)
base = 8 + strstart

def read_str(i):
    o = base + offsets[i]
    if utf8:
        n = mf[o]; o += 1
        if n & 0x80: n = ((n & 0x7f) << 8) | mf[o]; o += 1
        return mf[o:o+n].decode('utf-8', 'replace')
    n = struct.unpack_from('<H', mf, o)[0]; o += 2
    if n & 0x8000:
        n = ((n & 0x7fff) << 16) | struct.unpack_from('<H', mf, o)[0]; o += 2
    return mf[o:o+n*2].decode('utf-16-le', 'replace')

target = next((i for i in range(strcount) if read_str(i) == 'foregroundServiceType'), None)
assert target is not None, "清单里找不到 foregroundServiceType"

patched = 0
for pos in range(len(mf) - 24):
    # 属性结构：ns(4) name(4) rawValue(4) typedValue(8)
    if struct.unpack_from('<I', mf, pos + 4)[0] != target:
        continue
    tv = pos + 12
    size, res0, dt = struct.unpack_from('<HBB', mf, tv)
    if size != 8 or res0 != 0 or dt not in (0x10, 0x11):
        continue
    old = struct.unpack_from('<I', mf, tv + 4)[0]
    struct.pack_into('<I', mf, tv + 4, 0x40000000)   # FOREGROUND_SERVICE_TYPE_SPECIAL_USE
    print(f"   0x{pos:x}: 0x{old:x} → 0x40000000 (specialUse)")
    patched += 1
assert patched == 1, f"补丁命中 {patched} 处，预期 1 处"

with zipfile.ZipFile(dst, 'w') as zout:
    for item in zin.infolist():
        data = bytes(mf) if item.filename == 'AndroidManifest.xml' else zin.read(item.filename)
        zi = zipfile.ZipInfo(item.filename, date_time=item.date_time)
        zi.compress_type = item.compress_type     # resources.arsc 必须保持 STORED
        zi.external_attr = item.external_attr
        zout.writestr(zi, data)
PY

echo "== 6/8 对齐（zipalign） =="
zipalign -f 4 "$WORK/patched.apk" "$WORK/aligned.apk"
echo "   $(stat -c%s "$WORK/aligned.apk") 字节"

echo "== 7/8 签名（apksigner） =="
KS="$TOOLCHAIN_DIR/debug.keystore"
[ -f "$KS" ] || keytool -genkeypair -keystore "$KS" \
  -storepass android -keypass android -alias androiddebugkey \
  -dname "CN=Android Debug,O=Android,C=US" -keyalg RSA -keysize 2048 -validity 10000 2>/dev/null
apksigner sign --ks "$KS" --ks-pass pass:android --key-pass pass:android \
  --v1-signing-enabled true --v2-signing-enabled true \
  --out "$WORK/WhalePet.apk" "$WORK/aligned.apk"

echo "== 8/8 验证 =="
apksigner verify "$WORK/WhalePet.apk" >/dev/null && echo "   签名校验通过"
aapt dump xmltree "$WORK/WhalePet.apk" AndroidManifest.xml 2>/dev/null \
  | grep -E 'foregroundServiceType' | head -2

echo
echo "✅ 构建完成: $WORK/WhalePet.apk  ($(stat -c%s "$WORK/WhalePet.apk") 字节)"
echo "   安装: adb install -r \"$WORK/WhalePet.apk\""
