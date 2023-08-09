/* Required Modules */
const { entersState, joinVoiceChannel, VoiceConnectionStatus, EndBehaviorType, getVoiceConnection} = require('@discordjs/voice');
const { createWriteStream } = require('node:fs');
const prism = require('prism-media');
const { pipeline } = require('node:stream');
const { Client, Intents, MessageAttachment, Collection } = require('discord.js');
const ffmpeg = require('ffmpeg');
const sleep = require('util').promisify(setTimeout);
const fs = require('fs');
const path = require('path');

/* Initialize Discord Client */
const client = new Client({
    intents: [
        Intents.FLAGS.GUILDS,
        Intents.FLAGS.GUILD_MESSAGES,
        Intents.FLAGS.GUILD_MEMBERS,
        Intents.FLAGS.GUILD_VOICE_STATES
    ]
})

/* Collection to store voice state */
client.voiceManager = new Collection()

/* Ready event */
client.on("ready", () => {
    console.log("Connected as", client.user.tag, "to discord!");
})

let isRecording = false

/* When message is sent*/
client.on('messageCreate', async (message) => {
    if (!message.member.permissions.has('ADMINISTRATOR')) return message.channel.send('You do not have permission to use this command.');
    const voiceChannel = message.member.voice.channel
    if (message.content.startsWith('?record')) {
        if (isRecording) {
            return message.channel.send("I'm already recording")
        }

        isRecording = true;
        /* Check if the bot is in voice channel */
        let connection = client.voiceManager.get(message.channel.guild.id)

        if (!connection) {
            /* if user is not in any voice channel then return the error message */
            if(!voiceChannel) return message.channel.send("You must be in a voice channel to use this command!")

            connection = joinVoiceChannel({
                channelId: voiceChannel.id,
                guildId: voiceChannel.guild.id,
                selfDeaf: false,
                selfMute: true,
                adapterCreator: voiceChannel.guild.voiceAdapterCreator,
            });

            /* Add voice state to collection */
            client.voiceManager.set(message.channel.guild.id, connection);
            await entersState(connection, VoiceConnectionStatus.Ready, 20e3);
            const receiver = connection.receiver;

            receiver.speaking.on('start', (userId) => {
                /* create live stream to save audio */
                createListeningStream(receiver, userId, client.users.cache.get(userId));
            });

            return message.channel.send(`🎙️ I am now recording ${voiceChannel.name}`);

        }
    }
    else if (message.content.startsWith('?stop')) {
        if (!isRecording) {
            return message.channel.send("I'm not recording")
        }
        isRecording = false
        const msg = await message.channel.send("Please wait while I am preparing your recording...")

        await sleep(5000)
        /* Remove voice state from collection */
        client.voiceManager.delete(message.channel.guild.id)

        /* disconnect the bot from voice channel */
        const connection = getVoiceConnection(voiceChannel.guild.id);
        connection.destroy();

        /* Remove voice state from collection */
        client.voiceManager.delete(message.channel.guild.id)

        var filenames = fs.readdirSync('recordings/');
        filenames.forEach((file, index) => {
            if (file.endsWith('.pcm')) {
                filenames[index] = file.slice(0, -4); // Removing the last 4 characters (.pcm)
            }
        });
        for (let index in filenames) {
            let filename = filenames[index];
            const inputPath = path.join(__dirname, 'recordings', `${filename}.pcm`);
            const outputPath = path.join(__dirname, 'recordings', `${filename}.mp3`);

            try {
                var process = new ffmpeg(inputPath);
                process.then(function (audio) {
                    // Callback mode
                    audio.fnExtractSoundToMP3(outputPath, function (error, file) {
                        console.log("done")
                        if (!error)
                            console.log('Audio file: ' + file);
                    });
                }, function (err) {
                    console.log('Error: ' + err);
                });
            } catch (e) {
                console.log(e.code);
                console.log(e.msg);
            }
        }


    }
    else if(message.content.startsWith('?gdpr')) {
        message.channel.send({ files: [{ attachment: '7v89qc.jpg' }] })
    }
})


client.login("")


function createListeningStream(receiver, userId, user) {
    if (user.bot) return
    const opusStream = receiver.subscribe(userId, {
        end: {
            behavior: EndBehaviorType.AfterSilence,
            duration: 100,
        },
    });

    const oggStream = new prism.opus.OggLogicalBitstream({
        opusHead: new prism.opus.OpusHead({
            channelCount: 2,
            sampleRate: 48000,
        }),
        pageSizeControl: {
            maxPackets: 10,
        },
    });

    const filename = `./recordings/${user.username}.pcm`;

    const out = createWriteStream(filename, { flags: 'a' });
    console.log(`👂 Started recording ${filename}`);

    pipeline(opusStream, oggStream, out, (err) => {
        if (err) {
            console.warn(`❌ Error recording file ${filename} - ${err.message}`);
        } else {
            console.log(`✅ Recorded ${filename}`);
        }
    });
}