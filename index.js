const core = require('@actions/core');
const github = require('@actions/github');

const owner = core.getInput('owner', {required: true});
const repo = core.getInput('repo', {required: true});
const branch = core.getInput('branch', {required: true});
const token = core.getInput('token', {required: true});
const newTagName = core.getInput('newTagName', {required: true});

const octokit = new github.getOctokit(token);

function handleError(message) {
    throw new Error(message);
}

function isTagValid(newTag, latestTag) {
    let currentDate = new Date();
    let currentYear = currentDate.getUTCFullYear() % 100;
    let currentMonth = currentDate.getUTCMonth() + 1;
    const tagRegex = new RegExp(`^v${currentYear}${('00' + currentMonth).slice(-2)}.\\d$`);
    return tagRegex.test(newTag) && newTag > latestTag;
}

async function getLatestTagInfo() {
    const {data: latestTags} = await octokit.rest.repos.listTags({
        owner: owner,
        repo: repo,
        per_page: 1,
        page: 1
    });

    let latestTagSha = '', latestTagName = '';
    if (latestTags.length) {
        latestTagSha = latestTags[0]['commit']['sha'];
        latestTagName = latestTags[0]['name'];
    }

    return {latestTagSha, latestTagName};
}

async function getMergeCommitMessagesList(latestTagSha) {
    let mergeCommitsMessages = [];
    paginate:
        for await (const response of octokit.paginate.iterator(
            octokit.rest.repos.listCommits,
            {
                owner: owner,
                repo: repo,
                sha: branch,
            }
        )) {
            for (const commit of response.data) {
                let commitMessage = commit['commit']['message'].split('\n\n')[0];
                if (commit['sha'] === latestTagSha) {
                    break paginate;
                }
                if (commitMessage.startsWith('Merge pull request')) {
                    mergeCommitsMessages.unshift(commitMessage);
                }
            }
        }

    if (!mergeCommitsMessages.length) {
        handleError('No merge commits found');
    }
    return mergeCommitsMessages;
}

async function getLatestCommitSha() {
    const {data: latestCommits} = await octokit.rest.repos.listCommits({
        owner: owner,
        repo: repo,
        sha: branch,
        per_page: 1,
        page: 1
    });

    if (!latestCommits.length) {
        handleError('No commits found');
    }
    return latestCommits[0]['sha'];
}

async function createRelease(tagName, latestCommitSha, mergeCommitMessages) {
    await octokit.rest.repos.createRelease({
        owner: owner,
        repo: repo,
        tag_name: tagName,
        target_commitish: latestCommitSha,
        name: tagName,
        draft: false,
        prerelease: false,
        body: mergeCommitMessages.map(commit => `- ${commit}\n`).join('')
    });
}


const main = async () => {
    try {
        let {latestTagSha, latestTagName} = await getLatestTagInfo();

        if (!isTagValid(newTagName, latestTagName)) {
            handleError(`Tag is not valid: ${newTagName}`);
        }

        let mergeCommitMessages = await getMergeCommitMessagesList(latestTagSha);
        let latestCommitSha = await getLatestCommitSha();

        await createRelease(newTagName, latestCommitSha, mergeCommitMessages);

    } catch (error) {
        core.setFailed(error.message);
    }
}

main();
