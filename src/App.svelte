<div class="app">
	<h2>Image viewer</h2>
	<div style="width: 250px;">
		<zoo-input labeltext="Choose images to upload">
			<input slot="inputelement" type="file" multiple accept=".jpg, .jpeg, .png" on:change="{e => handleFileUpload(e)}" bind:this={_input}/>
		</zoo-input>
	</div>
	<div class="image-thumbnails-wrapper">
		{#each images as image, i}
			<div class="image-thumbnail">
				<img src={image.data} alt="image" on:load="{function() {window.URL.revokeObjectURL(this.src)}}"/>
				<p>{image.name}</p>
				<zoo-button on:click="{() => removeImage(i)}">
					<span slot="buttoncontent">Remove image</span>
				</zoo-button>
			</div>
		{:else}
			<p>You haven't uploaded any images yet!</p>
		{/each}
	</div>
</div>

<style type="text/scss">
	@import "variables";
	.app {
		margin: 20px;
	}

	.image-thumbnails-wrapper {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(100px, 185px));
		grid-template-rows: repeat(auto-fill, minmax(100px, 275px));
		grid-gap: 30px;
		margin: 10px;
		.image-thumbnail {
			cursor: pointer;
			border: 1px solid black;
			border-radius: 5px;
			padding: 10px;
			img {
				width: 150px;
				height: 150px;
			}
			p {
				text-align: center;
			}

			zoo-button {
				height: 45px;
				display: block;
			}
		}
	}
</style>

<script>
	let images = [];
	let _input;

	const handleFileUpload = e => {
		const temp = [...images];
		for (let i = 0; i < _input.files.length; i++) {
			const file = _input.files[i];
			temp.push({
				data: window.URL.createObjectURL(file),
				name: file.name
			});
		}
		images = temp;
		_input.value = null;
	}

	const removeImage = idx => {
		images = images.filter((img, i) => i !== idx);
	}
</script>