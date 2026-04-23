import java.io.File
import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("org.jetbrains.kotlin.plugin.serialization")
}

val keystoreProperties = Properties()
val keystorePropertiesFile = rootProject.file("keystore.properties")
if (keystorePropertiesFile.exists()) {
    keystorePropertiesFile.inputStream().use(keystoreProperties::load)
}

fun signingValue(propertyKey: String, envKey: String): String? =
    System.getenv(envKey)?.takeIf { it.isNotBlank() }
        ?: keystoreProperties.getProperty(propertyKey)?.takeIf { it.isNotBlank() }

val releaseStorePath = signingValue("storeFile", "EA_ANDROID_KEYSTORE_PATH")
val releaseStoreFile = releaseStorePath?.let { path ->
    val direct = File(path)
    if (direct.isAbsolute) direct else rootProject.file(path)
}
val releaseStorePassword = signingValue("storePassword", "EA_ANDROID_KEYSTORE_PASSWORD")
val releaseKeyAlias = signingValue("keyAlias", "EA_ANDROID_KEY_ALIAS")
val releaseKeyPassword = signingValue("keyPassword", "EA_ANDROID_KEY_PASSWORD")

val hasReleaseSigning =
    releaseStoreFile?.exists() == true &&
        !releaseStorePassword.isNullOrBlank() &&
        !releaseKeyAlias.isNullOrBlank() &&
        !releaseKeyPassword.isNullOrBlank()

val releaseTaskRequested = gradle.startParameter.taskNames.any { taskName ->
    taskName.contains("Release", ignoreCase = true)
}

if (releaseTaskRequested && !hasReleaseSigning) {
    throw GradleException(
        "Release signing is not configured. Create easyanalyse-mobile-android/keystore.properties " +
            "from keystore.properties.example or set EA_ANDROID_KEYSTORE_PATH, " +
            "EA_ANDROID_KEYSTORE_PASSWORD, EA_ANDROID_KEY_ALIAS, and EA_ANDROID_KEY_PASSWORD.",
    )
}

android {
    namespace = "cn.easyanalyse.mobile"
    compileSdk = 36

    defaultConfig {
        applicationId = "cn.easyanalyse.mobile"
        minSdk = 26
        targetSdk = 36
        versionCode = 110
        versionName = "1.1.0"
    }

    buildFeatures {
        compose = true
    }

    signingConfigs {
        create("release") {
            if (hasReleaseSigning) {
                storeFile = releaseStoreFile
                storePassword = releaseStorePassword
                keyAlias = releaseKeyAlias
                keyPassword = releaseKeyPassword
                enableV1Signing = true
                enableV2Signing = true
                enableV3Signing = true
                enableV4Signing = false
            }
        }
    }

    buildTypes {
        getByName("release") {
            isMinifyEnabled = false
            isShrinkResources = false
            if (hasReleaseSigning) {
                signingConfig = signingConfigs.getByName("release")
            }
        }
    }
}

kotlin {
    jvmToolchain(21)
}

dependencies {
    implementation(platform("androidx.compose:compose-bom:2024.06.00"))
    implementation("androidx.activity:activity-compose:1.9.1")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.4")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.4")
    implementation("com.google.android.gms:play-services-code-scanner:16.1.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.6.2")

    debugImplementation("androidx.compose.ui:ui-tooling")
}
