import java.net.URI
import com.github.gradle.node.pnpm.task.PnpmInstallTask
import com.github.gradle.node.pnpm.task.PnpmTask

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("com.github.node-gradle.node") version "7.1.0"
}

val enableTestTools = providers.gradleProperty("enableTestTools").orElse("false").get().toBooleanStrict()
val backendApiUrl = providers.gradleProperty("backendApiUrl")
    .orElse(providers.gradleProperty("parkiqUrl"))
    .orElse("https://testhyundai.devmultid.org").get().trim().trimEnd('/')
run {
    val uri = URI(backendApiUrl)
    require((uri.scheme == "https" || (enableTestTools && uri.scheme == "http")) && uri.host != null &&
        uri.rawUserInfo == null && uri.rawQuery == null && uri.rawFragment == null) {
        "backendApiUrl must be an HTTPS server URL (HTTP requires -PenableTestTools=true)"
    }
}
val frontendDir = rootProject.file("../frontend")
node {
    download.set(true)
    version.set("22.22.1")
    pnpmVersion.set("10.20.0")
    nodeProjectDir.set(frontendDir)
    // Dependency repositories are declared centrally in settings.gradle.kts.
    distBaseUrl.set(null as String?)
}
tasks.named<PnpmInstallTask>("pnpmInstall") {
    args.set(listOf("--frozen-lockfile"))
    environment.put("NODE_ENV", "development")
    environment.put("CI", "true")
}
val buildWebUi by tasks.registering(PnpmTask::class) {
    dependsOn("pnpmInstall")
    pnpmCommand.set(listOf("run", "build"))
    environment.put("NODE_ENV", "production")
    environment.put("VITE_API_BASE_URL", backendApiUrl)
    environment.put("VITE_ENABLE_TEST_TOOLS", enableTestTools.toString())
    inputs.property("backendApiUrl", backendApiUrl)
    inputs.property("enableTestTools", enableTestTools)
    inputs.files(fileTree(frontendDir) { exclude("node_modules/**", "dist/**", "*.tsbuildinfo") })
    outputs.dir(frontendDir.resolve("dist"))
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
        versionCode = 5
        versionName = "1.4.0"
        buildConfigField("String", "BACKEND_API_URL", "\"$backendApiUrl\"")
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
        debug {
            manifestPlaceholders["allowCleartext"] = enableTestTools.toString()
            buildConfigField("boolean", "ENABLE_TEST_TOOLS", enableTestTools.toString())
        }
        release {
            manifestPlaceholders["allowCleartext"] = "false"
            buildConfigField("boolean", "ENABLE_TEST_TOOLS", "false")
        }
    }
}

// AGP needs jlink, which is missing from some IDE-bundled JREs.
kotlin { jvmToolchain(21) }

tasks.named("preBuild").configure { dependsOn(generateGleoSchema, bundleWebUi) }

dependencies {
    implementation("ai.pleos.playground:NaviHelper:3.0.5")
    implementation("androidx.webkit:webkit:1.12.1")
}
