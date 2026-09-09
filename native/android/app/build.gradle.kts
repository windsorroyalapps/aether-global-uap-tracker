plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val appUrl: String = (project.findProperty("AETHER_APP_URL") as String?)
    ?: (rootProject.file("../app-url.txt").takeIf { it.exists() }?.readText()?.trim()
        ?: "https://aether-global-uap-tracker.vercel.app")

android {
    namespace = "app.aether.tracker"
    compileSdk = 35

    defaultConfig {
        applicationId = "app.aether.tracker"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "1.0.0"
        buildConfigField("String", "APP_URL", "\"${appUrl.replace("\"", "")}\"")
    }

    buildFeatures {
        buildConfig = true
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("debug")
        }
        debug {
            applicationIdSuffix = ".debug"
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
}
