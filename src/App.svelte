<zoo-header imgsrc="logo.jpg" imgalt="imgalt" headertext="Image viewer"></zoo-header>
<div class="app">
	<zoo-toast bind:this={_modalToast}></zoo-toast>
	<zoo-toast type="error" bind:this={_errorToast}></zoo-toast>
	<div class="menu">
		<zoo-input labeltext="Choose images to upload" infotext="Supported extensions are: .jpg, .jpeg, .png">
			<input slot="inputelement" type="file" multiple accept=".jpg, .jpeg, .png" on:change="{e => handleFileUpload(e)}" bind:this={_input}/>
		</zoo-input>
	</div>
	<div class="image-thumbnails-wrapper">
		{#each images as image, i}
			<div class="image-thumbnail">
				<img src={image.data} alt="image"/>
				<p>{image.name}</p>
				<zoo-button on:click="{() => openDetailsView(i)}">
					<span slot="buttoncontent">Open details view</span>
				</zoo-button>
			</div>
		{:else}
			<p>You haven't uploaded any images yet!</p>
		{/each}
	</div>
	<zoo-modal bind:this={_modal} class="modal-window">
		<div class="modal-content">
			<div class="action-buttons">
				<div class="rename">
					<zoo-input labeltext="Rename your file.">
						<input slot="inputelement" type="text"/>
					</zoo-input>
					<zoo-button on:click="{() => handleRenameButtonClick()}">
						<span slot="buttoncontent">Rename image</span>
					</zoo-button>
				</div>
				<zoo-button type="hot" on:click="{() => removeImage()}">
					<span slot="buttoncontent">Remove image</span>
				</zoo-button>
			</div>
			<div class="image-info">
				<img alt="image"/>
				<ul>
					{#if _modalImg}
						<li>File size: {_modalImg.size} bytes.</li>
						<li>File type: {_modalImg.type} bytes.</li>
						<li>Last modification date: {new Date(_modalImg.lastModified).toISOString()}.</li>
					{/if}
				</ul>
			</div>
		</div>
	</zoo-modal>
</div>

<style type="text/scss">
	.app {
		margin: 20px;
		display: grid;
		grid-template-columns: auto 1fr;

		@media only screen and (max-width: 550px) {
			grid-template-columns: 1fr;
		}
	}

	.image-thumbnails-wrapper {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(100px, 185px));
		grid-template-rows: repeat(auto-fill, minmax(100px, 275px));
		justify-content: center;
		grid-gap: 20px;
		margin: 10px;
		.image-thumbnail {
			border: 1px solid black;
			border-radius: 5px;
			padding: 10px;
			display: flex;
			flex-direction: column;
			align-items: center;
			img {
				max-width: 150px;
				max-height: 150px;
				width: auto;
				height: auto;
				margin-bottom: auto;
			}
			p {
				text-align: center;
				max-width: 160px;
				max-height: 20px;
				overflow: hidden;
				text-overflow: ellipsis;
				padding: 0 15px;
			}

			zoo-button {
				cursor: pointer;
				height: 45px;
				display: block;
			}
		}
	}

	.modal-window {
		.modal-content {
			display: grid;
			grid-template-columns: 400px 1fr;
			max-height: 700px;
			max-width: 100%;
			@media only screen and (max-width: 720px) {
				grid-template-columns: 1fr;
			}
			img {
				max-height: 500px; 
				width: 100%;
			}
			.action-buttons {
				display: flex;
				flex-direction: column;
				margin: 10px;
				gap: 10px;

				.rename {
					display: flex;
					flex-direction: column;
					padding: 5px;
					border: 1px solid black;
					border-radius: 5px;
				}
			}	

			zoo-feedback {
				margin: 5px;
			}
		}
	}
</style>

<script>
	let images = [];
	let _input;
	let _modal;
	let _modalToast;
	let _modalImg;
	let _idx;
	let _errorToast;
	const supportedExtensions = ['image/jpg', 'image/jpeg', 'image/png'];

	const handleFileUpload = e => {
		const temp = [...images];
		let badFiles = [];
		for (let i = 0; i < _input.files.length; i++) {
			const file = _input.files[i];
			if (!supportedExtensions.includes(file.type)) {
				badFiles.push(file.name);
			} else {
				temp.push({
					data: window.URL.createObjectURL(file),
					name: file.name,
					size: file.size,
					type: file.type,
					lastModified: file.lastModified
				});
			}
		}

		if (badFiles.length > 0) {
			_errorToast.text = `Could not upload ${badFiles.length} files. File names are: ${badFiles.join(', ')}`;
			_errorToast.show();
			badFiles = [];
		}
		images = temp;
		_input.value = null;
	}

	const removeImage = () => {
		images = images.filter((img, i) => i !== _idx);
		_modalToast.text = 'Image was succesfully removed!';
		_modalToast.show();
		_modal.closeModal();
	}

	const handleRenameButtonClick = () => {
		images[_idx].name = _modal.querySelector('input').value;
		_modalToast.text = 'Image was succesfully renamed!';
		_modalToast.show();
		_modal.closeModal();
	}

	const openDetailsView = idx => {
		_idx = idx;
		_modalImg = images[_idx];
		const imgName = _modalImg.name;
		_modal.headertext = imgName;
		_modal.querySelector('img').src = _modalImg.data;
		_modal.querySelector('input').value = imgName;
		_modal.style.display = 'block';
	}
</script>