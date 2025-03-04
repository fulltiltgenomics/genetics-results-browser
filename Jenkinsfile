pipeline {
  agent any
  stages {
    stage('Build') {
      steps {
        script {
 	  sh 'printenv'
          def c = docker.build("phewas-development/genetics-results-browser:ci-${env.$GIT_COMMIT}", '--build-arg CONFIG_FILE=src/config.finngen.json -f Dockerfile ./')
          docker.withRegistry('http://eu.gcr.io/phewas-development', 'gcr:phewas-development') { c.push("ci-${env.GIT_COMMIT}") }
          docker.withRegistry('http://eu.gcr.io/phewas-development', 'gcr:phewas-development') { c.push('ci-latest') }
        }
      }
    }
  }
}
