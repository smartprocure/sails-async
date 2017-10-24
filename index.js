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
// to set the name of the function
let method = f => ({
  [f.name]: async (req, res) => respond(f, success(res))(req, res)
})[f.name]

let policy = f => async (req, res, next) =>
  respond(f, next)(req, res)

let controller = _.mapValues(method)

// Policy that runs _after_ controller methods (with an optional normal `before` function)
let postPolicy = (fn, before=_.noop) => async (req, res, next) => {
  let resFn = res.send
  res.send = async (...args) => {
    await fn(req, res, ...args)
    return resFn.call(res, ...args)
  }
  await before(req, res)
  next()
}

// Gets controller/method info for a route
let getRouteData = ({options: {action}, _sails: {_actions}}) => ({
  type: _.dropRight(1, action.split('/')).join('-'),
  action: _.get(`${action}.name`, _actions) || _.last(action.split('/'))
})

let methodAliases = {
  createRecord: 'create',
  updateOneRecord: 'update',
  destroyOneRecord: 'destroy',
  findRecords: 'find',
}
let getAction = action => _.get(action, methodAliases) || action
let routeInfo = req => {
  let { action, type } = getRouteData(req)
  return {
    type,
    action: getAction(action),
    Model: req._sails.models[type],
  }
}

// modelPolicy will trigger any of the policies in the model based on the CRUD actions that are called from the client.
// modelPolicy will also filter properties by isDeleted by default, which provides an easy way to deal with soft-deleted records.
let modelPolicy = policy(async (req, res, params = {}) => {
  let { action, Model } = routeInfo(req)
  if (/find/i.test(action)) {
    if (!req.body) req.body = {}
    params.isDeleted = req.body.isDeleted = { '!=': true }
  }
  return _.getOr(_.noop, `policies.${action}`, Model)(req, res, params)
})

// modelPostPolicy is the same as the modelPolicy, but looks for properties in postPolicy (which are treated as postPolicies)
let modelPostPolicy = postPolicy(async (req, res, response) => {
  let { action, Model } = routeInfo(req)
  return _.getOr(_.noop, `postPolicies.${action}`, Model)(req, res, response)
})

// populatePolicy and populatePostPolicy go together.
// populatePolicy rips out any `populate` property coming from the request params or body,
// then sets this object in the request itself. This object Should contain as properties paths
// indicating where the ID properties are, and as value the model that will be
// used to fetch the right values. For example:
//     { 'path/to/userID': 'user' }
// Will populate `response.path.to.userID` with the user matching that ID, as
// long as the collection is named `user`.
let populatePolicy = policy(async (req, res, params = {}) => {
  if (params.populate) {
    req.populate = params.populate
    delete req.params.populate
    delete req.body.populate
  }
})
// populatePostPolicy uses the input obtained from populatePolicy to actually do the database queries to fill
// these properties. It is also possible to provide the path as a property in the model itself,
// to provide the values auto-populated in any request.
let populatePostPolicy = postPolicy(async (req, res, response) => {
  let { action, Model } = routeInfo(req)
  if (_.isArray(req.populate)) {
    await Promise.all(_.map(async record => {
      await Promise.all(_.map(async path => {
        let id = _.get(path, record)
        if (_.get('str', id)) { // is ObjectId
          let found = req._sails.models[req.populate[path]].findOne({id})
          _.set.convert({immutable: false})(path, found, record)
        }
      }, _.values(req.populate || Model.populate)))
    }, response))
  }
})

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
  routeInfo,
  modelPolicy,
  modelPostPolicy,
  populatePolicy,
  populatePostPolicy,
  bool: require('./bool')
}
