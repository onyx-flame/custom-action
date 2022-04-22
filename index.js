const core = require('@actions/core');
const github = require('@actions/github');

function isTagValid(newTag, latestTag) {
    let currentDate = new Date();
    let currentYear = currentDate.getUTCFullYear() % 100;
    let currentMonth = currentDate.getUTCMonth() + 1;
    const tagRegex = new RegExp(`^v${currentYear}${('00' + currentMonth).slice(-2)}.\\d$`);
    return tagRegex.test(newTag) && newTag > latestTag;
}

function handleError(message) {
    throw new Error(message);
}


const main = async () => {
    try {
        let latestTagName = '';
        let latestTagSha = '';
        let latestCommitSha = '';
        let pageNumber = 1;
        let exitLoops = false;
        let mergeCommitsMessages = [];

        const owner = core.getInput('owner', {required: true});
        const repo = core.getInput('repo', {required: true});
        const branch = core.getInput('branch', {required: true});
        const token = core.getInput('token', {required: true});
        const newTagName = core.getInput('newTagName', {required: true});

        const octokit = new github.getOctokit(token);

        const {data: latestTags} = await octokit.rest.repos.listTags({
            owner: owner,
            repo: repo,
            per_page: 1,
            page: 1
        });

        if (latestTags.length) {
            latestTagSha = latestTags[0]['commit']['sha'];
            latestTagName = latestTags[0]['name'];
        }

        if (!isTagValid(newTagName, latestTagName)) {
            handleError(`Tag is not valid: ${newTagName}`);
        }
        while (true) {
            const {data: listCommits} = await octokit.rest.repos.listCommits({
                owner: owner,
                repo: repo,
                sha: branch,
                page: pageNumber
            });
            if (!listCommits.length) {
                break;
            }
            if (latestCommitSha === '') {
                latestCommitSha = listCommits[0]['sha'];
            }
            for (const commit of listCommits) {
                let commitMessage = commit['commit']['message'].split('\n\n')[0];
                let commitSha = commit['sha'];
                if (commitSha === latestTagSha) {
                    exitLoops = true;
                    break;
                }
                if (commitMessage.startsWith('Merge pull request')) {
                    mergeCommitsMessages.unshift(`- ${commitMessage}\n`)
                }
            }
            if (exitLoops) {
                break;
            }
            pageNumber++;
        }

        if (!mergeCommitsMessages.length) {
            handleError('No merge commits found');
        }

        await octokit.rest.git.createTag({
            owner: owner,
            repo: repo,
            tag: newTagName,
            message: newTagName,
            object: latestCommitSha,
            type: 'commit'
        });
        await octokit.rest.git.createRef({
            owner: owner,
            repo: repo,
            ref: `refs/tags/${newTagName}`,
            sha: latestCommitSha
        });

        await octokit.rest.repos.createRelease({
            owner: owner,
            repo: repo,
            tag_name: newTagName,
            name: newTagName,
            draft: false,
            prerelease: false,
            body: mergeCommitsMessages.join('')
        });

    } catch (error) {
        core.setFailed(error.message);
    }
}

main();
