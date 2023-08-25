---
author: haimtran
title: develop an chatbot app and deploy on amazon ecs
date: 20/08/2023
---

## Introduction

[GitHub](https://github.com/entest-hai/ecs-chatbot-app/tree/master) this project shows how to build a chatbot and deploy it on amazon ecs. Here are main components

- [https://bot.entest.io](https://bot.entest.io)
- [video demo](https://d2cvlmmg8c0xrp.cloudfront.net/mp4/chatbot-app-demo-1.mp4)
- vercel ai sdk and hugging face model
- deploy the web app using cdk
- build a ci/cd pipeline using cdk

## Setup Project

Let create a new folder for the project

```bash
mkdir ecs-chatbot-app
```

Then init a new CDK project in typescript

```bash
cdk init --l typescript
```

Next, create a new nextjs project in chatbot-app folder

```bash
npx create-next-app@latest chatbot-app
```

Go into the chatbot-app folder and install some dependencies

```bash
npm install ai
```

Finally the project structure looks like this

```
|--bin
|--lib
|--chatbot-app
|--test
|--cdk.out
|--node_modules
|--cdk.context.json
|--cdk.json
|--jest.config.js
|--package-lock.json
|--package.json
|--README.md
|--tsconfig.json
```

## Build Chatbot

Prerequisites: you have to create a Hugging Face token [here]()

Let go int the directory chatbot-app and create a new nextjs project

```bash
npx create-next-app@latest
```

Then install dependencies

```bash
npm install ai openai @huggingface/inference clsx lucide-react
```

Store your Hugging Face token in .env

```bash
OPENAI_API_KEY=xxxxxxxxx
```

The nextjs project has a project structure as below

```
|--chatbot-app
   |--app
      |--api
         |--route.ts
      |--global.css
      |--icons.tsx
      |--layout.tsx
      |--page.tsx
    |--public
    |--.env
    |--.eslintrc.json
    |--Dockerfile
    |--next.config.js
    |--package-lock.json
    |--package.json
    |--postcss.config.js
    |--tailwind.config.ts
    |--tsconfig.json
```

## Build ECS Stack

Create an Amazon ECS Cluster and a service for the chatbot app in lib/ecs-stack.ts as the following

```ts
import {
  aws_ec2,
  aws_ecr,
  aws_ecs,
  aws_elasticloadbalancingv2,
  aws_iam,
  Duration,
  Stack,
  StackProps,
} from "aws-cdk-lib";
import { Effect } from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";

interface EcsProps extends StackProps {
  vpcId: string;
  vpcName: string;
}

export class EcsStack extends Stack {
  public readonly service: aws_ecs.FargateService;

  constructor(scope: Construct, id: string, props: EcsProps) {
    super(scope, id, props);

    // lookup an existed vpc
    const vpc = aws_ec2.Vpc.fromLookup(this, "LookUpVpc", {
      vpcId: props.vpcId,
      vpcName: props.vpcName,
    });

    // ecs cluster
    const cluster = new aws_ecs.Cluster(this, "EcsClusterForWebServer", {
      vpc: vpc,
      clusterName: "EcsClusterForWebServer",
      containerInsights: true,
      enableFargateCapacityProviders: true,
    });

    // ecs task definition
    const task = new aws_ecs.FargateTaskDefinition(
      this,
      "TaskDefinitionForWeb",
      {
        family: "latest",
        cpu: 2048,
        memoryLimitMiB: 4096,
        runtimePlatform: {
          operatingSystemFamily: aws_ecs.OperatingSystemFamily.LINUX,
          cpuArchitecture: aws_ecs.CpuArchitecture.X86_64,
        },
        // taskRole: "",
        // retrieve container images from ECR
        // executionRole: executionRole,
      }
    );

    // taask add container
    task.addContainer("NextChatbotContainer", {
      containerName: "entest-chatbot-app",
      memoryLimitMiB: 4096,
      memoryReservationMiB: 4096,
      stopTimeout: Duration.seconds(120),
      startTimeout: Duration.seconds(120),
      environment: {
        FHR_ENV: "DEPLOY",
      },
      // image: aws_ecs.ContainerImage.fromRegistry(
      //   "public.ecr.aws/b5v7e4v7/entest-chatbot-app:latest"
      // ),
      image: aws_ecs.ContainerImage.fromEcrRepository(
        aws_ecr.Repository.fromRepositoryName(
          this,
          "entest-chatbot-app",
          "entest-chatbot-app"
        )
      ),
      portMappings: [{ containerPort: 3000 }],
    });

    // service
    const service = new aws_ecs.FargateService(this, "ChatbotService", {
      vpcSubnets: {
        subnetType: aws_ec2.SubnetType.PUBLIC,
      },
      assignPublicIp: true,
      cluster: cluster,
      taskDefinition: task,
      desiredCount: 2,
      // deploymentController: {
      // default rolling update
      // type: aws_ecs.DeploymentControllerType.ECS,
      // type: aws_ecs.DeploymentControllerType.CODE_DEPLOY,
      // },
      capacityProviderStrategies: [
        {
          capacityProvider: "FARGATE",
          weight: 1,
        },
        {
          capacityProvider: "FARGATE_SPOT",
          weight: 0,
        },
      ],
    });

    // scaling on cpu utilization
    const scaling = service.autoScaleTaskCount({
      maxCapacity: 4,
      minCapacity: 1,
    });

    scaling.scaleOnMemoryUtilization("CpuUtilization", {
      targetUtilizationPercent: 50,
    });

    // application load balancer
    const alb = new aws_elasticloadbalancingv2.ApplicationLoadBalancer(
      this,
      "AlbForEcs",
      {
        loadBalancerName: "AlbForEcsDemo",
        vpc: vpc,
        internetFacing: true,
      }
    );

    // add listener
    const listener = alb.addListener("Listener", {
      port: 80,
      open: true,
      protocol: aws_elasticloadbalancingv2.ApplicationProtocol.HTTP,
    });

    // add target
    listener.addTargets("EcsService", {
      port: 80,
      targets: [
        service.loadBalancerTarget({
          containerName: "entest-chatbot-app",
          containerPort: 3000,
          protocol: aws_ecs.Protocol.TCP,
        }),
      ],
      healthCheck: {
        timeout: Duration.seconds(10),
      },
    });

    // exported
    this.service = service;
  }
}
```

## Build CI/CD Pipeline

Let create a CI/CD pipeline for deploying the chatbot app continuously as the following

```ts
import {
  Duration,
  RemovalPolicy,
  Stack,
  StackProps,
  aws_codebuild,
  aws_codecommit,
  aws_codepipeline,
  aws_codepipeline_actions,
  aws_ecr,
  aws_ecs,
  aws_iam,
} from "aws-cdk-lib";
import { Construct } from "constructs";
import * as path from "path";

interface CodePipelineProps extends StackProps {
  readonly connectArn?: string;
  readonly repoName: string;
  readonly repoBranch: string;
  readonly repoOwner: string;
  readonly ecrRepoName: string;
  readonly service: aws_ecs.FargateService;
}

export class CodePipelineStack extends Stack {
  constructor(scope: Construct, id: string, props: CodePipelineProps) {
    super(scope, id, props);

    // code commit
    const codecommitRepository = new aws_codecommit.Repository(
      this,
      "CodeCommitChatbot",
      {
        repositoryName: props.repoName,
      }
    );

    // ecr repository
    const ecrRepository = new aws_ecr.Repository(
      this,
      "EcrRepositoryForChatbot",
      {
        removalPolicy: RemovalPolicy.DESTROY,
        repositoryName: props.ecrRepoName,
        autoDeleteImages: true,
      }
    );

    // artifact - source code
    const sourceOutput = new aws_codepipeline.Artifact("SourceOutput");

    // artifact - codebuild output
    const codeBuildOutput = new aws_codepipeline.Artifact("CodeBuildOutput");

    // codebuild role push ecr image
    const codebuildRole = new aws_iam.Role(this, "RoleForCodeBuildChatbotApp", {
      roleName: "RoleForCodeBuildChatbotApp",
      assumedBy: new aws_iam.ServicePrincipal("codebuild.amazonaws.com"),
    });

    ecrRepository.grantPullPush(codebuildRole);

    // codebuild - build ecr image
    const ecrBuild = new aws_codebuild.PipelineProject(
      this,
      "BuildChatbotEcrImage",
      {
        projectName: "BuildChatbotEcrImage",
        role: codebuildRole,
        environment: {
          privileged: true,
          buildImage: aws_codebuild.LinuxBuildImage.STANDARD_5_0,
          computeType: aws_codebuild.ComputeType.MEDIUM,
          environmentVariables: {
            ACCOUNT_ID: {
              value: this.account,
              type: aws_codebuild.BuildEnvironmentVariableType.PLAINTEXT,
            },
            REGION: {
              value: this.region,
              type: aws_codebuild.BuildEnvironmentVariableType.PLAINTEXT,
            },
            REPO_NAME: {
              value: props.ecrRepoName,
              type: aws_codebuild.BuildEnvironmentVariableType.PLAINTEXT,
            },
            TAG: {
              value: "demo",
              type: aws_codebuild.BuildEnvironmentVariableType.PLAINTEXT,
            },
          },
        },

        // cdk upload build_spec.yaml to s3
        buildSpec: aws_codebuild.BuildSpec.fromAsset(
          path.join(__dirname, "./build_spec.yaml")
        ),
      }
    );

    // code pipeline
    new aws_codepipeline.Pipeline(this, "CodePipelineChatbot", {
      pipelineName: "CodePipelineChatbot",
      // cdk automatically creates role for codepipeline
      // role: pipelineRole,
      stages: [
        // source
        {
          stageName: "SourceCode",
          actions: [
            // new aws_codepipeline_actions.CodeStarConnectionsSourceAction({
            //   actionName: "GitHub",
            //   owner: props.repoOwner,
            //   repo: props.repoName,
            //   branch: props.repoBranch,
            //   connectionArn: props.connectArn,
            //   output: sourceOutput,
            // }),

            new aws_codepipeline_actions.CodeCommitSourceAction({
              actionName: "CodeCommitChatbot",
              repository: codecommitRepository,
              branch: "main",
              output: sourceOutput,
            }),
          ],
        },

        // build docker image and push to ecr
        {
          stageName: "BuildChatbotEcrImageStage",
          actions: [
            new aws_codepipeline_actions.CodeBuildAction({
              actionName: "BuildChatbotEcrImage",
              project: ecrBuild,
              input: sourceOutput,
              outputs: [codeBuildOutput],
            }),
          ],
        },

        // deploy new tag image to ecs service
        {
          stageName: "EcsCodeDeploy",
          actions: [
            new aws_codepipeline_actions.EcsDeployAction({
              // role: pipelineRole,
              actionName: "Deploy",
              service: props.service,
              input: codeBuildOutput,
              // imageFile: codeBuildOutput.atPath(""),
              deploymentTimeout: Duration.minutes(10),
            }),
          ],
        },
      ],
    });
  }
}
```

> [!IMPORTANT]

> CDK automatically create role for codebuild, codedeploy, and codepipeline. Below is the content of the iam policy generated for codepipeline role. The codepline role will assume on of three different role for codebuild action, ecsdeploy action, and source action.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Action": [
        "s3:Abort*",
        "s3:DeleteObject*",
        "s3:GetBucket*",
        "s3:GetObject*",
        "s3:List*",
        "s3:PutObject",
        "s3:PutObjectLegalHold",
        "s3:PutObjectRetention",
        "s3:PutObjectTagging",
        "s3:PutObjectVersionTagging"
      ],
      "Resource": [
        "arn:aws:s3:::artifact-bucket-name",
        "arn:aws:s3:::artifact-bucket-name/*"
      ],
      "Effect": "Allow"
    },
    {
      "Action": [
        "kms:Decrypt",
        "kms:DescribeKey",
        "kms:Encrypt",
        "kms:GenerateDataKey*",
        "kms:ReEncrypt*"
      ],
      "Resource": "arn:aws:kms:ap-southeast-1:$ACCOUNT_ID:key/$KEY_ID",
      "Effect": "Allow"
    },
    {
      "Action": "sts:AssumeRole",
      "Resource": [
        "arn:aws:iam::$ACCOUNT_ID:role/CodePipelineChatbotBuildC-9DSS5JG1VE7T",
        "arn:aws:iam::$ACCOUNT_ID:role/CodePipelineChatbotEcsCod-AO6ZDE82ELPC",
        "arn:aws:iam::$ACCOUNT_ID:role/CodePipelineChatbotSource-1SZLHE9CFAAXO"
      ],
      "Effect": "Allow"
    }
  ]
}
```

## CDK Deploy

- Step 1. Build and test the chatbot app manually
- Step 2. Deploy the EcsStack
- Step 3. Deploy the CodePipelineChatbotStack

**Step 1. Build and test the chatbot app manually**

There is a python script in /chatbot-app/build.py will

- Create a ECR repository named: entest-chatbot-app
- Build and push an image to entest-chatbot-app

```py
import os

# parameters
REGION = "ap-southeast-1"
ACCOUNT = ""

# delete all docker images
os.system("sudo docker system prune -a")

# build entest-chatbot-app image
os.system("sudo docker build -t entest-chatbot-app . ")

#  aws ecr login
os.system(f"aws ecr get-login-password --region {REGION} | sudo docker login --username AWS --password-stdin {ACCOUNT}.dkr.ecr.{REGION}.amazonaws.com")

# get image id
IMAGE_ID=os.popen("sudo docker images -q entest-chatbot-app:latest").read()

# tag entest-chatbot-app image
os.system(f"sudo docker tag {IMAGE_ID.strip()} {ACCOUNT}.dkr.ecr.{REGION}.amazonaws.com/entest-chatbot-app:latest")

# create ecr repository
os.system(f"aws ecr create-repository --registry-id {ACCOUNT} --repository-name entest-chatbot-app")

# # push image to ecr
os.system(f"sudo docker push {ACCOUNT}.dkr.ecr.{REGION}.amazonaws.com/entest-chatbot-app:latest")
```

Let run go to the chatbot-app and run this python script

```bash
cd chatbot-app
python3 build.py
```

You can test this iamge locally

```bash
sudo docker run -p 3000:3000 $IMAGE_NAME
```

**Step 2. Deploy the EcsStack**

Goto the bin directory and deploy the ecs cluster using cdk

```bash
cdk deploy EcsStack
```

> [!IMPORTANT]
> The ECS task will pull the image from the entest-chatbot-app reposotry created from the build.py above. In step 3, we will replace this manual setp by a CI/CD pipeline (simple verion without blue/green deployment). After deploying the ECS cluster, please find the Application Load Blancer endpoint and check that the app working.

**Step 3. Deploy the CodePipeline**

> [!IMPORTANT]
> This code pipeline will build ecr image and push to the entest-chatbot-app repository created by build.py. Then CodeDeploy will deploy latest image to the ecs task.

```bash
cdk deploy CodePipelineChatbotStack
```

## Referece

- [aws docs ecs standard](https://docs.aws.amazon.com/codepipeline/latest/userguide/ecs-cd-pipeline.html)

- [aws docs ecs blue green](https://docs.aws.amazon.com/codepipeline/latest/userguide/tutorials-ecs-ecr-codedeploy.html)

- [aws docs ecs](https://docs.aws.amazon.com/codedeploy/latest/userguide/tutorial-ecs-deployment.html)

- [ecs task and execution role](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_definition_parameters.html)

- [AmazonEC2ContainerRegistryPowerUser](https://docs.aws.amazon.com/codepipeline/latest/userguide/ecs-cd-pipeline.html)

- [vercel ai sdk](https://sdk.vercel.ai/docs/guides/providers/hugging-face)

- [github markdown guide](https://docs.github.com/en/get-started/writing-on-github/getting-started-with-writing-and-formatting-on-github/basic-writing-and-formatting-syntax)
