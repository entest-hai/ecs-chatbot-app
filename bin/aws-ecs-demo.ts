#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { EcsStack } from "../lib/ecs-stack";
import { CodePipelineStack } from "../lib/codepipeline-stack";

const app = new cdk.App();

const ecs = new EcsStack(app, "EcsStack", {
  vpcId: "vpc-08fcf91d258dccdb7",
  vpcName: "EksVpc",
  env: {
    region: process.env.CDK_DEFAULT_REGION,
    account: process.env.CDK_DEFAULT_ACCOUNT,
  },
});

new CodePipelineStack(app, "CodePipelineChatbotStack", {
  repoName: "ecs-chatbot-app",
  repoBranch: "master",
  repoOwner: "entest-hai",
  ecrRepoName: "entest-chatbot-app",
  service: ecs.service,
  env: {
    region: process.env.CDK_DEFAULT_REGION,
    account: process.env.CDK_DEFAULT_ACCOUNT,
  },
});
