'use strict';

const core = require('@actions/core');
const { GitHub, context } = require('@actions/github');
const superagent = require('superagent');

core.debug(`PR Duplicator - Context ${JSON.stringify(context, null, 2)}`);

const envOwner = context.repo.owner;
const envRepo = context.repo.repo;

const eventPayload = context.payload;
const confFrom = core.getInput('from'); // Branch from which the PR was created (head)
const confBase = core.getInput('base'); // Branch where the PR was requested
const confTo = core.getInput('to'); // Branch to which the new PR is created
const confPrAuthor = core.getInput('pr-author'); // Who has to be author of the PR to be duplicated
const confGithubToken = core.getInput('github-token');
const confSlackIncomingWebhookUrl = core.getInput('slack-incoming-webhook-url');

if (!eventPayload || !eventPayload.pull_request) {
    throw new Error('INVALID CONFIGURATION: Invalid event type configuration, event payload must contain "pull_request" property. See: https://help.github.com/en/actions/automating-your-workflow-with-github-actions/events-that-trigger-workflows#pull-request-event-pull_request');
}

// https://developer.github.com/v3/pulls/
const payloadPullRequest = eventPayload.pull_request;
const payloadPullRequestNumber = payloadPullRequest.number; // Ex: 5
const payloadPullRequestAuthor = payloadPullRequest.user.login; // Ex: tiblu
const payloadBase = payloadPullRequest.base; // Branch where the PR was requested. Ex: master
const payloadFrom = payloadPullRequest.head; // Branch from which the PR was created (head). Ex: l10n_mater

if ((confFrom !== "*" && payloadFrom.ref !== confFrom) || payloadBase.ref !== confBase) {
    return core.info(`SKIP! Skipping Action as the configured "from" and "base" ("${confFrom}","${confBase}") don't match the event payload ("${payloadFrom.ref}","${payloadBase.ref}")`);
}

if (confPrAuthor && payloadPullRequestAuthor !== confPrAuthor) {
    return core.info(`SKIP! Skipping Action as the configured "pr-author" ("${confPrAuthor}") does not match the PR author in the payload ("${payloadPullRequestAuthor}")`);
}

if (!payloadPullRequest.merged) {
    return core.warning(`SKIP! Skipping Action as the closed PR has not been merged! PR url ${payloadPullRequest.url}`);
}

const sendSlackMessage = async (message) => {
    return await superagent
        .post(confSlackIncomingWebhookUrl)
        .send(message);
};

const runAction = async () => {
    // https://octokit.github.io/rest.js/
    // https://github.com/actions/toolkit/tree/master/packages/github
    const octokit = new GitHub(confGithubToken);

    // Create a PR from the "from" branch to "to"
    // https://octokit.github.io/rest.js/#octokit-routes-pulls-create
    // https://developer.github.com/v3/pulls/#create-a-pull-request
    const {data: pullRequestCreated} = await octokit.pulls.create({
        owner: envOwner,
        repo: envRepo,
        title: `AUTO: PR-Duplicator - "${payloadPullRequest.title}".`,
        body: `This pull request is automatically created by GitHub Action PR Duplicator. Created from: ${payloadPullRequest.html_url}`,
        head: payloadPullRequest.head.ref,
        base: confTo
    });

    core.debug(`pullRequestCreated - ${JSON.stringify(pullRequestCreated, null, 2)}`);

    // https://octokit.github.io/rest.js/#octokit-routes-issues-create-comment
    // https://developer.github.com/v3/issues/comments/#create-a-comment
    // https://developer.github.com/v3/guides/working-with-comments/#pull-request-comments - PR is just a type of issue, thus issue comments API is used.
    const {data: commentCreated} = await octokit.issues.createComment({
        owner: envOwner,
        repo: envRepo,
        issue_number: payloadPullRequestNumber,
        body: `AUTO: PR-Duplicator - A pull request was automatically created after merging this one. NEW PR: ${pullRequestCreated.html_url}`
    });

    core.debug(`commentCreated - ${JSON.stringify(commentCreated, null, 2)}`);

    // https://api.slack.com/messaging/webhooks
    // https://api.slack.com/tools/block-kit-builder
    // https://help.github.com/en/actions/automating-your-workflow-with-github-actions/creating-and-using-encrypted-secrets
    if (confSlackIncomingWebhookUrl) {
        try {
            await sendSlackMessage({
                "blocks": [
                    {
                        type: 'section',
                        text: {
                            type: 'mrkdwn',
                            text: '*PR-Duplicator*: A pull request has been duplicated!'
                        }
                    },
                    {
                        type: 'section',
                        text: {
                            type: 'mrkdwn',
                            text: `Merged PR: ${payloadPullRequest.html_url}`
                        }
                    },
                    {
                        type: 'section',
                        text: {
                            type: 'mrkdwn',
                            text: `NEW PR: ${pullRequestCreated.html_url}`
                        }
                    }
                ]
            });
        } catch (err) {
            core.warning(`SLACK NOTIFICATION FAILED! ${JSON.stringify(err, null, 2)}`);
        }
    }

    core.info(`Pull request has been created - ${pullRequestCreated.html_url}`);
};

runAction()
    .then(() => {
        core.info('OK!');
    })
    .catch(async (err) => {
        core.error(`ERROR ${JSON.stringify(err, null, 2)} ${JSON.stringify(context, null, 2)}`);

        if (confSlackIncomingWebhookUrl) {
            try {
                await sendSlackMessage({
                    "blocks": [
                        {
                            type: 'section',
                            text: {
                                type: 'mrkdwn',
                                text: '*PR-Duplicator*: A pull request duplication *FAILED*!'
                            }
                        },
                        {
                            type: 'section',
                            text: {
                                type: 'mrkdwn',
                                text: `View checks: ${eventPayload.html_url}/actions`
                            }
                        }
                    ]
                });
            } catch (err) {
                core.warning(`SLACK NOTIFICATION FAILED! ${JSON.stringify(err, null, 2)}`);
            }
        }

        core.setFailed(err.message);
    });