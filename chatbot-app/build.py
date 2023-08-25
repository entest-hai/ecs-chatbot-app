# please export ACCOUNT in terminal
import os

# parameters
REGION = "ap-southeast-1"
REPO_NAME = "entest-chatbot-app"
ACCOUNT = os.environ["ACCOUNT"]

# delete all docker images
os.system("sudo docker system prune -a")

# build image
os.system(f"sudo docker build -t {REPO_NAME} . ")

#  aws ecr login
os.system(f"aws ecr get-login-password --region {REGION} | sudo docker login --username AWS --password-stdin {ACCOUNT}.dkr.ecr.{REGION}.amazonaws.com")

# get image id
IMAGE_ID=os.popen(f"sudo docker images -q {REPO_NAME}:latest").read()

# tag image
os.system(f"sudo docker tag {IMAGE_ID.strip()} {ACCOUNT}.dkr.ecr.{REGION}.amazonaws.com/{REPO_NAME}:latest")

# create ecr repository
os.system(f"aws ecr create-repository --registry-id {ACCOUNT} --repository-name {REPO_NAME}")

# # push image to ecr
os.system(f"sudo docker push {ACCOUNT}.dkr.ecr.{REGION}.amazonaws.com/{REPO_NAME}:latest")