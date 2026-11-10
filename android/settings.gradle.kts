pluginManagement { repositories { google(); mavenCentral(); gradlePluginPortal() } }
// Lets Gradle download the JDK 21 toolchain on machines that do not have one.
plugins { id("org.gradle.toolchains.foojay-resolver-convention") version "1.0.0" }
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
        maven { url = uri("https://nexus-playground.pleos.ai/repository/maven-releases/") }
    }
}
rootProject.name = "ParkIQVehicle"
include(":app")
