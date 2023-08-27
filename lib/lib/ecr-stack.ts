import { RemovalPolicy, Stack, StackProps, aws_ecr } from "aws-cdk-lib";
import { Construct } from "constructs";

interface EcrProps extends StackProps {
  repoName: string;
}

export class EcrStack extends Stack {
  public readonly repoName: string;
  constructor(scope: Construct, id: string, props: EcrProps) {
    super(scope, id, props);

    const ecr = new aws_ecr.Repository(this, "EcrRepositoryForChatbot", {
      removalPolicy: RemovalPolicy.DESTROY,
      repositoryName: props.repoName,
      autoDeleteImages: true,
    });

    this.repoName = ecr.repositoryName;
  }
}
