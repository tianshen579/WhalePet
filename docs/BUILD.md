# 构建指南

两条路线，按你手上的环境挑一条。

| | 标准路线 | 免 SDK 路线 |
|---|---|---|
| 需要 | JDK 17 + Android SDK Platform 35 + Gradle 8.11.1 | JDK 17 + aapt + d8 + apksigner + zipalign |
| 依赖下载量 | 较大（Gradle + Maven 依赖） | 较小（一个 R8 jar + 一个 android.jar） |
| 适合 | 常规开发、Android Studio | 没有 Android SDK 的环境，例如直接在手机上构建 |
| 脚本 | `build.py` 或 `gradle :app:assembleDebug` | `tools/whalepet-build.sh` |

---

## 一、标准路线

需要 **Python 3.9+**、**JDK 17**、**Android SDK Platform 35** 与对应 Build Tools。

1. 安装 Android Studio，在 SDK Manager 里装 **Android SDK Platform 35** 和 **Build-Tools**
2. 设置 `ANDROID_HOME` 指向 SDK 目录；也可以在工程根目录建 `local.properties`：

   ```properties
   sdk.dir=/你的/SDK/路径
   ```

   （Windows 路径可以用正斜杠）

3. 构建：

   ```bash
   python build.py
   ```

   脚本会下载官方 Gradle 8.11.1 并校验 SHA-256。已有 Gradle 8.11.1 的话也可以：

   ```bash
   gradle :app:assembleDebug
   ```

4. 产物在 `app/build/outputs/apk/debug/app-debug.apk`（调试签名的安装包）

> 工程没有附带 Gradle wrapper JAR，首次构建需要能访问 Google Maven、
> Maven Central 与 Gradle 官方下载服务。

### 也可以用 GitHub Actions

仓库里带了 `.github/workflows/android.yml`。推上去之后在 Actions 页面手动执行
**Build Android APK**，就能下载构建产物，不用本地装 SDK。

---

## 二、免 SDK 路线

这条路线不依赖 Android SDK 和 Gradle —— 直接调 `aapt` / `javac` / `d8` /
`apksigner` 手搓出一个签好名的 APK。**本工程就是在没有 SDK 的环境里用这条路线
构建并真机验证的。**

### 需要准备的工具

| 工具 | 从哪来 | 说明 |
|---|---|---|
| `javac` / `keytool` | `apt install openjdk-17-jdk-headless` | 编译 Java、生成调试密钥 |
| `aapt` | `apt install aapt` | 链接资源。必须是 **arm64/你本机架构原生** 的版本 |
| `apksigner` / `zipalign` | `apt install apksigner zipalign` | 签名与对齐 |
| 框架资源表 | `apt install android-framework-res` | `aapt` 链接资源用，**必须是 API 33 那一代的表** |
| `d8` | `com.android.tools:r8` 的 jar | 纯 Java，跨架构通用 |
| `android.jar` | `org.robolectric:android-all` | 纯 Java，跨架构通用；只作 classpath |

后两样从 Maven 取（注意版本号要对应 API 级别）：

```bash
# d8（在 r8 jar 里）
curl -L -o r8.jar \
  https://maven.aliyun.com/repository/google/com/android/tools/r8/<版本>/r8-<版本>.jar

# android-all：API 35 对应 15-robolectric-*
curl -L -o android-all.jar \
  https://repo1.maven.org/maven2/org/robolectric/android-all/15-robolectric-<构建号>/android-all-15-robolectric-<构建号>.jar
```

### 关键：框架资源表

`aapt` 链接资源时需要一份**框架资源表**（`resources.arsc`）。

**踩坑提醒**：不要用 `android-all.jar` 里的 `resources.arsc`。那是 **API 35** 的新格式
（紧凑条目），`aapt` 解析不了，会刷一屏这样的错误然后失败：

```
E aapt: Entry offset at index 0 points outside the Type's boundaries
E aapt: Index 1 points to entry with unaligned offset 0x0015000e
```

Debian / Ubuntu 的 `android-framework-res` 包提供的是 **API 33** 那一代的表，
`aapt` 能正常解析：

```bash
sudo apt install android-framework-res
# → /usr/share/android-framework-res/framework-res.apk
```

脚本默认就用这个路径，也可以用 `FRAMEWORK_APK=/别的/路径` 覆盖。

代价是 API 34 才引入的 `specialUse` 枚举值它不认识 —— 这正是下面第 2 步要处理的。

> `android-all.jar` 仍然需要，但只作为 **javac 和 d8 的 classpath**（提供
> `android.jar` 的类），不参与资源链接。

### 两处构建期处理

工程源码是给 AGP 8 写的，走这条路时需要两步额外处理 —— `tools/whalepet-build.sh`
里已经自动做了：

1. **清单补 `package` 属性**
   AGP 8 用 `namespace`，而 `aapt` v1 要求清单里有 `package`：

   ```xml
   <manifest xmlns:android="..." package="io.github.tianshen579.whalepet">
   ```

2. **`foregroundServiceType="specialUse"` 的替换与回填**
   `specialUse` 是 **API 34** 才有的枚举值。如果手上的框架资源表是 API 33 的，
   `aapt` 会拒绝这个值（符号名和整数都不收）。做法是：**先用 API 33 认识的
   `dataSync` 编译，产物出来后再原地改二进制清单里的值**。

   Android 二进制 XML 里，属性结构是 `ns(4) + name(4) + rawValue(4) + typedValue(8)`，
   flags 属性的 `typedValue` 是 `size=8, res0=0, dataType=0x11, data=<值>`。
   脚本会解析字符串池定位 `foregroundServiceType`，确认无误后把值改成
   `0x40000000`（`SPECIAL_USE`），改完再用 `aapt dump xmltree` 反查验证。

   最终产物里应该能看到：

   ```
   A: android:foregroundServiceType(0x01010599)=(type 0x11)0x40000000
   ```

### 构建

```bash
./tools/whalepet-build.sh
```

脚本会依次做：生成构建用清单 → `aapt` 链接资源 → `javac` 编译 → `d8` 转 dex →
打包并打清单补丁 → `zipalign` 对齐 → `apksigner` 签名，最后输出
`build/WhalePet.apk`。

### 安装到手机

如果手机上有 shell 权限（例如通过 Shizuku 或 adb）：

```bash
adb install -r WhalePet.apk
```

**注意**：用 `pm install` 装 `/sdcard` 上的文件会因为 SELinux 上下文被拒
（`System server has no access to read file context ... fuse`）。
先把 APK 复制到 `/data/local/tmp/` 再装：

```bash
cp WhalePet.apk /data/local/tmp/ && chmod 644 /data/local/tmp/WhalePet.apk
pm install -r /data/local/tmp/WhalePet.apk
```

---

## 三、跑测试

```bash
node --test tests/brain.test.cjs
```

覆盖喂食边界、冷却、睡眠、存档、拖动状态切换与自主活动，共 7 项。

网页演示可以直接用浏览器打开 `WhalePet-demo.html`（图片和代码都已内嵌），
用来核对角色、白米饭与全部互动，**但它不能代替真机验证**。

## 四、发布签名

### 调试密钥 vs 正式密钥

仓库里的构建脚本会自动生成一个**调试密钥**（`debug.keystore`，密码是公开的
`android`）。它**只能用于自己测试** —— 任何人都能用同一把调试密钥签出包名相同的
APK，商店也不会接受。

正式发布必须用你自己生成的密钥。它不只是"一个密码"，而是**应用的终身身份**：
Android 用它验证「这个安装包确实来自你、且没有被篡改」。

> ⚠️ **三条铁律**
> 1. **丢了就完了** —— 同一包名的应用必须始终用同一把密钥签名，否则老用户无法覆盖
>    安装，只能先卸载（**应用数据全丢**）。Google Play 上包名与密钥的绑定是永久的
> 2. **绝不进版本库** —— 密钥库文件加密码泄露 = 任何人都能冒名发布你的应用更新
> 3. **多处备份** —— 离线存一份（U 盘 / 密码管理器），别只放在一台机器上

### 生成

```bash
keytool -genkeypair \
  -keystore whalepet-release.jks \
  -alias whalepet \
  -keyalg RSA -keysize 4096 -validity 10000 \
  -storetype JKS
```

会依次问你：

| 提示 | 填什么 |
|---|---|
| `Enter keystore password` | **密钥库密码** —— 和密钥本身一样重要，一起备份 |
| `Re-enter new password` | 再输一遍 |
| `What is your first and last name?` | 可填你的名字或组织名，会显示在证书里 |
| `What is the name of your organizational unit?` | 可留空 |
| `What is the name of your organization?` | 可留空 |
| `What is the name of your City or Locality?` | 可留空 |
| `What is the name of your State or Province?` | 可留空 |
| `What is the two-letter country code for this unit?` | 可填 `CN` |
| `Is CN=... correct?` | 输入 `yes` |
| `Enter key password for <whalepet>` | 直接回车 = 与密钥库密码相同（推荐，少记一个） |

生成后**立刻确认文件在**，并把它移到版本库之外：

```bash
ls -l whalepet-release.jks
mv whalepet-release.jks ~/keys/        # 放到仓库外面
```

### 用免 SDK 脚本签名

构建脚本目前用调试密钥。换成你自己的，加两个参数即可：

```bash
apksigner sign \
  --ks ~/keys/whalepet-release.jks \
  --ks-key-alias whalepet \
  --out WhalePet-release.apk \
  build/aligned.apk
```

（会交互式询问密码；也可以 `--ks-pass env:WHALEPET_STORE_PASS` 从环境变量读，
**不要把密码写进脚本或命令行历史**。）

验证签名：

```bash
apksigner verify --verbose --print-certs WhalePet-release.apk
```

### 用 Gradle 签名

在 `app/build.gradle` 里加 `signingConfigs`，密码从 `local.properties` 或环境变量读
（`local.properties` 已在 `.gitignore` 里）：

```gradle
android {
    signingConfigs {
        release {
            storeFile file(System.getenv("WHALEPET_KEYSTORE") ?: "release.jks")
            storePassword System.getenv("WHALEPET_STORE_PASS")
            keyAlias "whalepet"
            keyPassword System.getenv("WHALEPET_KEY_PASS")
        }
    }
    buildTypes {
        release { signingConfig signingConfigs.release }
    }
}
```

### 上架 Google Play

开启 **Play App Signing**：Google 保管真正的应用签名密钥，你只保留一把「上传密钥」。
好处是上传密钥丢了可以申请重置，主密钥不用你操心。首次上传时 Play 会引导你开启。

## 五、发布前检查

- [ ] 用正式密钥替换调试密钥，并确认密钥库不在仓库里
- [ ] 美术资源的授权条款（见 [LICENSE](../LICENSE) 末尾说明）
- [ ] 如果想换包名：`app/build.gradle`、Java 目录与 `package` 行、
      `tools/whalepet-build.sh` 三处要一起改（包名至少两段，`aapt` 强制）
