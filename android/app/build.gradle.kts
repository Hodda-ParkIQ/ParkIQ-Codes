import java.net.URI

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val backendApiUrl = providers.gradleProperty("backendApiUrl")
    .orElse(providers.gradleProperty("parkiqUrl")).orElse("").get()
if (backendApiUrl.isNotEmpty()) {
    val uri = URI(backendApiUrl)
    require(uri.scheme in listOf("http", "https") && uri.host != null &&
        uri.rawUserInfo == null && uri.rawQuery == null && uri.rawFragment == null) {
        "backendApiUrl must be an HTTP(S) server URL"
    }
}
val frontendDir = rootProject.file("../frontend")
val buildWebUi by tasks.registering(Exec::class) {
    workingDir(frontendDir)
    commandLine("corepack", "pnpm@10.20.0", "build")
    inputs.files(fileTree(frontendDir) { exclude("node_modules/**", "dist/**", "*.tsbuildinfo") })
    outputs.dir(frontendDir.resolve("dist"))
    doFirst { require(frontendDir.resolve("node_modules").isDirectory) {
        "Run corepack pnpm@10.20.0 install --frozen-lockfile in frontend first."
    } }
}
val bundleWebUi by tasks.registering(Sync::class) {
    dependsOn(buildWebUi)
    from(frontendDir.resolve("dist"))
    into(layout.buildDirectory.dir("generated/webAssets"))
}
val generateGleoSchema by tasks.registering(Copy::class) {
    from(rootProject.file("gleo-app-schema.json"))
    into(layout.buildDirectory.dir("generated/gleoAssets"))
    rename { "schema.json" }
}
android {
    namespace = "ai.parkiq.vehicle"
    compileSdk = 35
    useLibrary("android.car")
    defaultConfig {
        applicationId = "ai.parkiq.vehicle"
        minSdk = 31
        targetSdk = 35
        versionCode = 4
        versionName = "1.3.0"
        buildConfigField("String", "BACKEND_API_URL", "\"${backendApiUrl.trimEnd('/')}\"")
    }
    buildFeatures { buildConfig = true }
    sourceSets["main"].assets.srcDir(layout.buildDirectory.dir("generated/gleoAssets"))
    sourceSets["main"].assets.srcDir(layout.buildDirectory.dir("generated/webAssets"))
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    buildTypes {
        debug { manifestPlaceholders["allowCleartext"] = "true" }
        release { manifestPlaceholders["allowCleartext"] = "false" }
    }
}

tasks.named("preBuild").configure { dependsOn(generateGleoSchema, bundleWebUi) }

dependencies {
    implementation("ai.pleos.playground:NaviHelper:3.0.5")
    implementation("androidx.webkit:webkit:1.12.1")
}
