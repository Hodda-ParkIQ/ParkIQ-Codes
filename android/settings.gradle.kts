pluginManagement { repositories { google(); mavenCentral(); gradlePluginPortal() } }
// Lets Gradle download the JDK 21 toolchain on machines that do not have one.
plugins { id("org.gradle.toolchains.foojay-resolver-convention") version "1.0.0" }
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
        maven { url = uri("https://nexus-playground.pleos.ai/repository/maven-releases/") }
        exclusiveContent {
            forRepository {
                ivy {
                    name = "Node.js"
                    url = uri("https://nodejs.org/dist")
                    patternLayout { artifact("v[revision]/[artifact](-v[revision]-[classifier]).[ext]") }
                    metadataSources { artifact() }
                }
            }
            filter { includeModule("org.nodejs", "node") }
        }
    }
}
rootProject.name = "ParkIQVehicle"
include(":app")
