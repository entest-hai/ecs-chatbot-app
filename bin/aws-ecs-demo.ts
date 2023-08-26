#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { EcsStack } from "../lib/ecs-stack";
import { CodePipelineStack } from "../lib/codepipeline-stack";
import { EcrStack } from "../lib/ecr-stack";

const app = new cdk.App();

// create a ecr repository
const ecr = new EcrStack(app, "EcrStack", {
  repoName: "entest-chatbot-app",
});

// create an ecs cluster
const ecs = new EcsStack(app, "EcsStack", {
  vpcId: "YOUR_VPC_ID_HERE",
  vpcName: "EksVpc",
  ecrRepoName: ecr.repoName,
  env: {
    region: process.env.CDK_DEFAULT_REGION,
    account: process.env.CDK_DEFAULT_ACCOUNT,
  },
});

// create a pipeline
new CodePipelineStack(app, "CodePipelineChatbotStack", {
  repoName: "ecs-chatbot-app",
  repoBranch: "master",
  repoOwner: "entest-hai",
  ecrRepoName: ecr.repoName,
  service: ecs.service,
  env: {
    region: process.env.CDK_DEFAULT_REGION,
    account: process.env.CDK_DEFAULT_ACCOUNT,
  },
});
