import groovy.json.JsonSlurper
plugins { id("com.android.application") }
@Suppress("UNCHECKED_CAST")
// Explicit configuration input: a cached Gradle model must never keep the
// previous release's versionCode/name when the shared native config changes.
val standard = JsonSlurper().parseText(providers.fileContents(
    rootProject.layout.projectDirectory.file("../config.json")
).asText.get()) as Map<String, Any>
@Suppress("UNCHECKED_CAST")
val upstream = standard["upstream"] as Map<String, Any>
val keyPath = System.getenv("STANDARD_ANDROID_KEYSTORE")?.takeIf { it.isNotBlank() }
val unsignedCandidate = System.getenv("STANDARD_UNSIGNED_CANDIDATE") == "1"
// Names must not shadow SigningConfig's receiver properties in the Kotlin DSL.
val signingStorePassword = System.getenv("STANDARD_ANDROID_STORE_PASSWORD")
val signingKeyPassword = System.getenv("STANDARD_ANDROID_KEY_PASSWORD")
val signingKeyAlias = System.getenv("STANDARD_ANDROID_KEY_ALIAS") ?: "pokebonk-standard"
val releaseRequested = gradle.startParameter.taskNames.any { it.contains("assembleRelease", true) || it.contains("bundleRelease", true) }
if (releaseRequested && !unsignedCandidate) require(!keyPath.isNullOrBlank() && !signingStorePassword.isNullOrBlank() && !signingKeyPassword.isNullOrBlank()) {
    "Standard release signing is required. Use standard/scripts/build-android.mjs with the stable external keystore."
}
android {
    namespace = "dev.nicartjay.pokebonk.offline.standard"
    compileSdk = 36
    defaultConfig {
        applicationId = standard["applicationId"].toString()
        minSdk = 26
        targetSdk = 36
        versionCode = (standard["androidVersionCode"] as Number).toInt()
        versionName = standard["version"].toString()
        buildConfigField("String", "RELEASE_CERTIFICATE", "\"${standard["androidCertificateSha256"] ?: ""}\"")
        buildConfigField("String", "RELEASE_REPOSITORY", "\"${standard["repository"]}\"")
        buildConfigField("String", "UPSTREAM_VERSION", "\"${upstream["version"]}\"")
        buildConfigField("String", "UPSTREAM_BUILD", "\"${upstream["build"]}\"")
        resValue("string", "app_name", standard["productName"].toString())
    }
    signingConfigs {
        if (!unsignedCandidate && keyPath != null) create("standardRelease") {
            storeFile = file(keyPath)
            this.storePassword = signingStorePassword
            this.keyPassword = signingKeyPassword
            this.keyAlias = signingKeyAlias
        }
    }
    buildTypes {
        release {
            if (!unsignedCandidate && keyPath != null) signingConfig = signingConfigs.getByName("standardRelease")
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    buildFeatures { buildConfig = true; resValues = true }
    androidResources { noCompress += setOf("m4a", "mp3", "mp4", "ogg", "wav", "webm") }
    sourceSets.getByName("test").resources.directories.add("../../test/fixtures")
    lint {
        abortOnError = true
        checkReleaseBuilds = true
        warningsAsErrors = true
        disable += setOf("AndroidGradlePluginVersion", "GradleDependency", "DiscouragedApi",
            "MonochromeLauncherIcon", "ObsoleteSdkInt", "OldTargetApi")
    }
}
dependencies {
    testImplementation("junit:junit:4.13.2")
    // Real JSON validation in JVM tests; this is NOT packaged in the APK.
    testImplementation("org.json:json:20240303")
}
