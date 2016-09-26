 /************************************************************************************************
  *                                    ORKA Server
  *                                    -----------
  *  Entry point of orka
  *  loads ui and opens sockets for client communication. Acts as a bridge between ui and the clients
  *
  *
  ***********************************************************************************************/

'use strict'

// const electron = require('electron')
const {app, BrowserWindow} = require('electron')
const io = require('socket.io')()
const {ipcMain} = require('electron')

const settings = require('./settings.js') // Persistent settings storage
const port = settings.getServerOptions().port || 8000
const piSocketManager = require('./pi-Communicator.js') // maps socket id into name and vice versa

let win = null
let contents = null

function init () {
  win = new BrowserWindow({width: 800, height: 500, show: false})
  win.loadURL(`file://${__dirname}/ui/index.html`)

   win.webContents.openDevTools()
    // win.maximize();
  win.setFullScreen(true)

  win.once('closed', () => {
    win = null
  })
  // wait for electron to load the page
  win.once('ready-to-show', () => {
    win.show()
  })
  contents = win.webContents
}

(function () {
  app.once('ready', init)
  io.listen(port)
})()

app.on('window-all-closed', () => {
  app.quit()
})
io.on('connection', function (socket) {
  var clientName = socket.handshake.query.client_name // Client name should be passed during connection
  if (clientName === undefined) {
    socket.disconnect()
  } else {
    piSocketManager.addSocket(clientName, socket.id)

    contents.send('setPiConnectionStatus', {
      name: clientName,
      connected: true
    })
  }

  socket.on('disconnect', function () {
    if (piSocketManager.getNameFromSocketId(socket.id) != null) {
      contents.send('setPiConnectionStatus', {
        name: piSocketManager.getNameFromSocketId(socket.id),
        connected: false
      })
    }
    piSocketManager.removeSocket(socket.id)
  })

  /************************************************************************************************
   *
   *      The following are the events supported by Orka. These events should in sync with orka-IPC-bridge.js.
   *
   *      <-  denotes the events coming from client to Orka Server
   *      ->  denotes the events going to the client from the Orka Server
   *      --  denotes the events which flows through the Orka UI and Orka Server
   *
   *
   ***********************************************************************************************/

  /**
   * Event <- stats; statistics received from client
   * @type object
   */
  socket.on('stats', function (data) {
    var name = piSocketManager.getNameFromSocketId(socket.id) // convert socket id into name
    if (!name) {
      console.error('un-registered client is sending stats')
    }
    if (name != null) {
      contents.send('stats', {
        'name': name,
        'data': data
      })
    } else {
      socket.disconnect()
    }
  })

/**
 * Event <- output; output of executed command from client. see TaskSchedular and Batch Execution
 * @type object
 */
  socket.on('output', function (data) {
    contents.send('output', {
      'name': piSocketManager.getNameFromSocketId(socket.id),
      output: data
    })
  })

/**
 * Event <- alert;generated by the client when the statistics threashold is surpassed
 * @type string
 */
  socket.on('alert', (data) => {
    console.log(data)
    contents.send('alert', {
      name: piSocketManager.getNameFromSocketId(socket.id),
      message: data
    })
  })

/**
 * Event <- systemInfo; basic system information from the client. Obtained at the connecting phase
 * @type Object
 */
  socket.on('systemInfo', (data) => {
    contents.send('systemInfo', {
      name: piSocketManager.getNameFromSocketId(socket.id),
      data
    })
  })
})

/**
 * Event -> Command; the command sent to client and executed
 * @type string
 */
ipcMain.on('Command', (event, name, command) => {
  var socketId = piSocketManager.getSocketIdFromName(name)
  if (socketId != null) {
    io.sockets.connected[socketId].emit('Command', command)
  }
})

ipcMain.on('piRemoved', function (event, item) {
  var sock_id = piSocketManager.getSocketIdFromName(item)
  var client_sock = io.sockets.connected[sock_id]

  // remove from both memory and storage
  piSocketManager.removeSocket(sock_id)
  settings.removeClient(item)
  if (client_sock != undefined)
    client_sock.disconnect()
})

ipcMain.on('piAdded', function (event, args) {
  // when added , try to client to conenct
  var param = {}
  param['name'] = args.name
  // client connection settings defines ip,name and port for the client to connect to
  param['settings'] = settings.getClientConnectionSettings()
  piSocketManager.connectToPi(args.ip, args.port, param)
  settings.addClient(args.name, {
    ip: args.ip,
    port: args.port
  })
})

ipcMain.on('listCreated', (event, listName, args) => {
  settings.addList(listName, args)
})
ipcMain.on('listRemoved', (event, listName) => {
  settings.removeList(listName)
})
ipcMain.on('clientAddedToList', (event, listName, clients) => {
  settings.addClientsToList(listName, clients)
})
ipcMain.on('clientRemovedFromList', (event, listName, clients) => {
  settings.removeClientFromList(listName, clients)
})
ipcMain.on('taskCreated', (event, taskName, args) => {
  settings.addTask(taskName, args)
})
ipcMain.on('taskDeleted', (event, taskname) => {
  settings.removeTask(taskname)
})
ipcMain.on('disconnect', (event, name) => {
  var sock_id = piSocketManager.getSocketIdFromName(name)
  var client_sock = io.sockets.connected[sock_id]

  if (client_sock != undefined) {
    client_sock.disconnect()
  }
})

ipcMain.on('connect', (event, args) => {
  var param = {}
  param['name'] = args.name
  param['settings'] = settings.getClientConnectionSettings()
  piSocketManager.connectToPi(args.ip, args.port, param)
})

ipcMain.on('quit', () => {
  var pi = piSocketManager.getAllSocketsName()

  for (var name in pi) {
    io.sockets.connected[piSocketManager.getSocketIdFromName(pi[name])].disconnect()
  }

  setTimeout(function () {
    app.quit()
  }, 100)
})

/**
 * Event -- open-url; opens URL in a new electron window
 * @type {BrowserWindow}
 */
ipcMain.on('open-url', (event, clientname, hostname) => {
  let shell = new BrowserWindow({width: 600, height: 600, title: clientname})

  // the url is passed as parameter to the html file, which load the URL into webview.
  // bypass cross-origin-policy
  shell.loadURL(`file://${__dirname}/ui/test.html?${hostname}`)
  shell.on('closed', () => {
    shell = null
  })
})

ipcMain.on('minimize', () => win.minimize())

/**
 * events -- *; to read settings from secondary storage
 */

ipcMain.on('client-info-settings', function (event) {
  event.returnValue = settings.getClients() || {}
})
ipcMain.on('lists-info-settings', function (event) {
  event.returnValue = settings.getAllLists() || {}
})
ipcMain.on('tasks-info-settings', function (event) {
  event.returnValue = settings.getAllTasks() || {}
})
ipcMain.on('client-connection-settings', function (event) {
  event.returnValue = settings.getClientConnectionSettings() || {}
})
ipcMain.on('notification-settings', function (event) {
  event.returnValue = settings.getNotificationStatus() || {}
})
ipcMain.on('toggle-notification-status', function (event, type, state) {
  settings.toggleNotificationStatus(type, state)
})
ipcMain.on('set-server-options', function (event, port) {
  settings.setServerOptions(port)
})
ipcMain.on('get-server-options', function (event) {
  event.returnValue = port
})
ipcMain.on('set-client-connection-settings', function (event, options) {
  settings.setClientConnectionSettings(options)
})
ipcMain.on('set-flock-webhook', function (event, webhook) {
  settings.setFlockWebHook(webhook)
})
ipcMain.on('reset-default-settings', function (event) {
  settings.resetSettings()
  contents.send('settings-restored-to-default')
})