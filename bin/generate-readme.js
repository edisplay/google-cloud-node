#!/usr/bin/env node

const chalk = require('chalk')
const fetch = require('node-fetch')
const figures = require('figures')
const { readFileSync, writeFileSync } = require('fs')

let argv = null
const apiUrl = 'https://api.github.com'

function checkpoint (message, success = true) {
  const prefix = success ? chalk.green(figures.tick) : chalk.red(figures.cross)
  console.info(`${prefix} ${message}`)
}

// grab files using GitHub API.
async function getContent (owner, repo, path) {
  const headers = {}
  if (argv.token) headers.authorization = `token ${argv.token}`
  const resp = await fetch(`${apiUrl}/repos/${owner}/${repo}/contents/${path}`, {
    headers: headers
  })
    .then(res => {
      if (res.status !== 200) {
        const err = Error(`unexpected status = ${res.status}`)
        err.status = res.status
        throw err
      }
      return res.json()
    })
  return JSON.parse(Buffer.from(resp.content, 'base64').toString('utf8'))
}

// for each repo listed in sloth/repos.json pull down .repo-metadata.json.
async function collectRepoMetadata (repos) {
  const repoMetadata = {}
  for (let i = 0, repo; (repo = repos[i]) !== undefined; i++) {
    if (repo.language === 'nodejs') {
      try {
        const [o, r] = repo.repo.split('/')
        repoMetadata[r] = await getContent(o, r, '.repo-metadata.json')
        checkpoint(`${repo.repo} found .repo-metadata.json`)
      } catch (err) {
        if (err.status === 404) checkpoint(`${repo.repo} had no .repo-metadata.json`, false)
        else throw err
      }
    }
  }
  return repoMetadata
}

// Fills in README.mustache with contents loaded from sloth/repos.json.
// Given the simplicity of the template, we do not actually use a templating
// engine, instead calling string.replace.
function generateReadme (repoMetadata) {
  const template = readFileSync('./bin/README.mustache', 'utf8')
  const libraries = []
  // partition libraries by release type.
  Object.keys(repoMetadata).forEach(key => {
    const metadata = repoMetadata[key]
    if (metadata.api_id) {
      // making naming more consistent, sometimes we've appended Cloud,
      // sometimes Google Cloud.
      metadata.name_pretty = metadata.name_pretty.replace(/^(Google )?Cloud /, '')
      libraries.push(metadata)
    }
  })

  libraries.sort((a, b) => {
    return a.name_pretty.localeCompare(b.name_pretty)
  })

  let partial = ''
  libraries.forEach((lib) => {
    partial += `| [${lib.name_pretty}](https://github.com/${lib.repo}) | \`npm i ${lib.distribution_name}\` | [Enable API](https://console.cloud.google.com/flows/enableapi?apiid=${lib.api_id}) | ${lib.requires_billing ? figures.tick : figures.cross} |\n`
  })

  writeFileSync('./README.md', template.replace('{{libraries}}', partial), 'utf8')
}

require('yargs')
  .command('$0', 'generate README from sloth list of repos', () => {}, async (_argv) => {
    argv = _argv
    const repos = (await getContent('googleapis', 'sloth', 'repos.json')).repos
    checkpoint('loaded list of repos from sloth')
    const repoMetadata = await collectRepoMetadata(repos)
    generateReadme(repoMetadata)
  })
  .option('token', {
    describe: 'GitHub authorization token'
  })
  .parse()
