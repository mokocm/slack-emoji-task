const {WebClient} = require("@slack/web-api");
const axios = require("axios").create({baseURL: "https://api.trello.com/1"});
const aws = require("aws-sdk");
const documentClient = new aws.DynamoDB.DocumentClient({region: "ap-northeast-1"})

const TableName = "trello-slack-thread";

const token = process.env.SLACK_TOKEN;
const trello_key = process.env.TRELLO_KEY;
const trello_token = process.env.TRELLO_TOKEN;
const trello_list = process.env.TRELLO_LIST;

exports.index = async (event, context) => {
  const body = JSON.parse(event.body);
  try {
    if (body.type === "url_verification") {
      const res = {challenge: body.challenge};
      console.log("Challenge");
      return {statusCode: 200, body: JSON.stringify(res)}
    }
    if (body.event.type === "reaction_added") {
      if (body.event.reaction === "task-add") {
        await taskHandler(body);
        return {statusCode: 200}
      }
      if (body.event.reaction === "task-checklist-add") {
        await checkListHandler(body);
        return {statusCode: 200}
      }
    }
  } catch (e) {
    console.log(e)
    return {statusCode: 500}
  }
};

async function taskHandler(body) {
  const web = new WebClient(token);
  const {channel, ts} = body.event.item;
  console.log(body);
  // メッセージ取得
  const result = await web.conversations.history({
    channel,
    oldest: ts,
    latest: ts,
    inclusive: true,
    limit: 1
  }).catch(console.log);
  console.log(result)
  const message = result.messages[0].text;

  // カード起票
  const card = await addCard(message);
  // チェックリスト作成
  const checklist = await createCheckList(card.data.id, "CheckList");
  console.log(checklist.data)
  // スレッド, カードID, チェックリストIDをDynamoDBに追加
  const put = await putDB(ts, card.data.id, checklist.data.id, body.event.user);
  console.log(put)
}

async function checkListHandler(body) {
  const web = new WebClient(token);
  const {channel, ts} = body.event.item;
  const replies = await web.conversations.replies({
    channel,
    ts,
    inclusive: true
  });
  console.log(replies);
  const message = replies.messages[0].text;
  const thread_id = replies.messages[0].thread_ts;

  const data = await getTrelloData(thread_id);
  console.log(data)
  const {slack_ts, cardId, checkListId, author} = data.Items[0];
  if (!(body.event.user === author)) return;
  const checklist = await addCheckList(checkListId, message);
  console.log(checklist.data);

}

async function addCard(name) {
  return axios.post("/cards", {
    name,
    idList: trello_list,
    key: trello_key,
    token: trello_token,
  });
}

async function putDB(slack_ts, cardId, checkListId, author) {
  const params = {
    TableName,
    Item: {
      slack_ts,
      cardId,
      checkListId,
      author
    }
  };

  return documentClient.put(params).promise();
}

async function getTrelloData(slack_ts) {
  const params = {
    TableName,
    KeyConditionExpression: "slack_ts = :slack_ts",
    ExpressionAttributeValues: {
      ":slack_ts": slack_ts
    }
  };
  return documentClient.query(params).promise();
}

async function createCheckList(idCard, name) {
  return axios.post("/checklist", {
    idCard,
    name,
    key: trello_key,
    token: trello_token

  })
}

async function addCheckList(checkListId, name) {
  return axios.post(`/checklists/${checkListId}/checkItems`, {
    name,
    key: trello_key,
    token: trello_token
  });
}
