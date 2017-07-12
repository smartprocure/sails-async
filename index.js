let _ = require('lodash/fp')

// Based on http://stackoverflow.com/questions/18391212/is-it-not-possible-to-stringify-an-error-using-json-stringify
var errorToObject = function(err) {
  var plainObject = {}
  Object.getOwnPropertyNames(err).forEach(function(key) {
    plainObject[key] = err[key]
  })
  return plainObject
}

// Custom Response
let send = defaultStatus => res => data => {
  if (_.isNil(data)) data = {}
  if (_.isNumber(data)) data = { statusCode: data }
  // Actual exceptions
  if (data.stack) {
    data = errorToObject(data)
    //this.req._sails.log.error(data)
  }
  // Stop Mongoose Models from doing weird stuff preventing status from going
  if (data.toObject) data = data.toObject({ minimize: false })

  res
    .status(data.statusCode || defaultStatus)
    .send(data.body || (data.statusCode && _.omit('statusCode', data)) || data)
}
let fail = send(500)
let success = send(200)

// Asyncification
let respond = (f, next) => async (req, res) => {
  try {
    next(await f(req, res, req.allParams && req.allParams()))
  }
  catch (e) {
    fail(res)(e)
  }
}
let method = f => {
  let result = {
    [f.name]: async (req, res) => respond(f, success(res))(req, res)
  }
  return result[f.name]
}
let policy = f => async (req, res, next) =>
  respond(f, next)(req, res)

let controller = _.mapValues(method)

// Policy that runs _after_ controller methods (with an optional normal `before` function)
let postPolicy = (fn, before=_.noop) => async (req, res, next) => {
  let resFn = res.send
  res.send = async (...args) => {
    await fn(req, res, ...args)
    return resFn(...args)
  }
  await before(req, res)
  next()
}

// Gets controller/method info for a route
let getRouteData = ({options: {action}, _sails: {_actions}}) => ({
  type: _.dropRight(1, action.split('/')).join('-'),
  action: (_actions[action].name !== '' && _actions[action].name) || _.last(action.split('/'))
})

// Gets controller/method info for a route
let getRouteData = ({ options: {action}}) => parseOptionsString(action)

module.exports = {
  send,
  fail,
  success,

  respond,
  method,
  policy,
  controller,

  postPolicy,
  getRouteData,
  parseOptionsString
}
