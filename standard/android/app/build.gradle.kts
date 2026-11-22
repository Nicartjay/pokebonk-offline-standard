import groovy.json.JsonSlurper
plugins { id("com.android.application") }
@Suppress("UNCHECKED_CAST")
val standard = JsonSlurper().parse(rootProject.file("../config.json")) as Map<String, Any>
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
dependencies { testImplementation("junit:junit:4.13.2") }
